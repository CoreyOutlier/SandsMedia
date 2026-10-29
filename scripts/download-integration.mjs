// Read-only route checks against existing synthetic media. This script cannot
// connect to a production origin or database and never prints file metadata.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
import {drive as createDrive, auth as googleAuth} from 'googleapis/build/src/apis/drive/index.js';
const mode=process.argv[2]??'all';
assert.ok(['all','--zip-only','--range-only'].includes(mode));
const origin=process.env.APP_URL;
assert.equal(origin,'http://localhost:3102');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'download-test',email:'allowed@example.test',verifiedGoogle:true},maxAge:3600});
const cookie=`authjs.session-token=${jwt}`;
async function digest(body){const hash=createHash('sha256');let bytes=0;for await(const chunk of body){hash.update(chunk);bytes+=chunk.length;}return {hash:hash.digest('hex'),bytes};}
async function get(path,expected=200,headers={cookie}){const response=await fetch(origin+path,{headers,signal:AbortSignal.timeout(60000)});if(response.status!==expected){await response.body?.cancel();throw new Error('UNEXPECTED_STATUS_'+response.status);}return response;}
let stage='setup';
try{
 const credentials=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON,'base64').toString());
 const api=createDrive({version:'v3',auth:new googleAuth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/drive']})});
 await db.connect();
 const session=(await db.query(`SELECT s.id,s.patient_id FROM sessions s WHERE s.finished_at IS NOT NULL AND EXISTS (SELECT 1 FROM media m WHERE m.session_id=s.id AND m.kind='photo') AND EXISTS (SELECT 1 FROM media m WHERE m.session_id=s.id AND m.kind='video') ORDER BY s.created_at DESC LIMIT 1`)).rows[0];
 assert.ok(session,'SYNTHETIC_MEDIA_REQUIRED');
 const rows=(await db.query(`SELECT DISTINCT ON (kind) id,kind,drive_file_id,bytes FROM media WHERE session_id=$1 ORDER BY kind,position`,[session.id])).rows;
 for(const row of mode==='--zip-only'?[]:rows){
   const path=`/api/media/${row.id}/download`;
   if(mode!=='--range-only'){
   stage=row.kind+'_authentication';await get(path,401,{});
   stage=row.kind+'_library_boundary';await get(path+'?general=1',404);
   stage=row.kind+'_original_download';const response=await get(path);
   stage=row.kind+'_headers';assert.ok(response.headers.get('content-disposition')?.startsWith('attachment;'));
   const cache=response.headers.get('cache-control')?.split(',').map(value=>value.trim());assert.ok(cache?.includes('private'));assert.ok(cache?.includes('no-store'));
   assert.equal(response.headers.get('accept-ranges'),'bytes');
   assert.equal(response.headers.get('content-length'),String(row.bytes));
   assert.ok(response.headers.get('content-type')?.startsWith(row.kind==='photo'?'image/':'video/'));
   stage=row.kind+'_portal_bytes';const received=await digest(response.body);
   stage=row.kind+'_drive_bytes';const original=await api.files.get({fileId:row.drive_file_id,alt:'media',supportsAllDrives:true},{responseType:'stream',signal:AbortSignal.timeout(60000)});
   const source=await digest(original.data);stage=row.kind+'_bytes_match';assert.deepEqual(received,source);
   }
   stage=row.kind+'_download_range';const range=await get(path,206,{cookie,Range:'bytes=0-127'});
   assert.equal(range.headers.get('content-range'),`bytes 0-127/${row.bytes}`);assert.equal((await range.arrayBuffer()).byteLength,128);
   stage=row.kind+'_invalid_range';await get(path,416,{cookie,Range:'bytes=999999999999-'});
 }
 if(mode!=='--range-only'){
 stage='patient_archive_authentication';await get(`/api/download/patient/${session.patient_id}`,401,{});
 stage='patient_archive';const zip=await get(`/api/download/patient/${session.patient_id}`);
 assert.equal(zip.headers.get('content-type'),'application/zip');assert.ok(zip.headers.get('content-disposition')?.startsWith('attachment;'));
 const zipBytes=Buffer.from(await zip.arrayBuffer());assert.equal(zipBytes.readUInt32LE(0),0x04034b50);assert.ok(zipBytes.includes(Buffer.from('/Photos/')));assert.ok(zipBytes.includes(Buffer.from('/Videos/')));
 }
 if(mode==='--zip-only')console.info('PASS: authenticated synthetic patient ZIP includes Photos and Videos.');
 else if(mode==='--range-only')console.info('PASS: synthetic photo/video download ranges and invalid-range rejection.');
 else console.info('PASS: synthetic photos/videos download byte-for-byte from Drive, authenticated routes and library boundaries, attachment/no-store headers, byte ranges, invalid ranges, and full patient ZIP with Photos/Videos.');
}catch(error){const safe=['ERR_ASSERTION','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];const code=/^UNEXPECTED_STATUS_\d+$/.test(error.message)?'_'+error.message:safe.includes(error.code)?'_'+error.code:safe.includes(error.cause?.code)?'_'+error.cause.code:'';console.error('DOWNLOAD_INTEGRATION_FAILED_'+stage+code);process.exitCode=1;}finally{await db.end();}
