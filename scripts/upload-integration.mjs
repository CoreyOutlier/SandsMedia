import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';

// Run only with the isolated test environment and generated synthetic fixture.
// Never print API bodies, signed URLs, credentials, names, or original filenames.
const origin=process.env.APP_URL;
assert.equal(origin,'http://localhost:3102');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'test-user',email:'allowed@example.test',verifiedGoogle:true},maxAge:600});
async function api(path,body,expected=200){
 const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie:`authjs.session-token=${jwt}`,origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const json=await r.json();if(r.status!==expected)throw new Error(`API_CHECK_FAILED_${r.status}_${json.error??'UNKNOWN'}`);return json;
}
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
try{
 await db.connect();
 // A Google identity cannot take over a batch started by a clinic cookie.
 const existing=await db.query('SELECT id FROM upload_batches LIMIT 1');
 if(existing.rows[0])await api(`/api/uploads/${existing.rows[0].id}/status`,undefined,404);
 const video=await readFile(new URL('../qa/upload-fixtures/synthetic-video.mp4',import.meta.url));
 // Valid MP4 padding makes the fixture cross the 8 MiB chunk boundary.
 const free=Buffer.alloc(9*1024*1024);free.writeUInt32BE(free.length,0);free.write('free',4);const bytes=Buffer.concat([video,free]);
 const files=[{key:randomUUID(),fingerprint:createHash('sha256').update(bytes).digest('hex'),kind:'video',label:'other',mimeType:'video/mp4',bytes:bytes.length,width:640,height:480,durationS:2}];
 const makeInput=()=>({uploadId:randomUUID(),kind:'general',title:'Synthetic general footage',date:'2026-10-29',description:'Synthetic integration fixture only',uploadedBy:'Automated test',consented:false,formOnFile:false,files});
 const ids=[];
 for(let run=0;run<2;run++){
  const input=makeInput();const batch=await api('/api/uploads/start',input);ids.push(batch.id);
  assert.equal((await api('/api/uploads/start',input)).id,batch.id);
  await api(`/api/uploads/${batch.id}/finish`,{},409);
  const signed=await api(`/api/uploads/${batch.id}/sign`,{key:files[0].key});
  assert.equal((await api(`/api/uploads/${batch.id}/sign`,{key:files[0].key})).url,signed.url);
  const cut=8*1024*1024;
  let r=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Range':`bytes 0-${cut-1}/${bytes.length}`},body:bytes.subarray(0,cut),signal:AbortSignal.timeout(60000)});assert.equal(r.status,308);
  r=await fetch(signed.url,{method:'PUT',headers:{'Content-Range':`bytes */${bytes.length}`},body:Buffer.alloc(0),signal:AbortSignal.timeout(30000)});assert.equal(r.status,308);assert.equal(r.headers.get('range'),`bytes=0-${cut-1}`);
  r=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Range':`bytes ${cut}-${bytes.length-1}/${bytes.length}`},body:bytes.subarray(cut),signal:AbortSignal.timeout(60000)});assert.ok([200,201].includes(r.status));
  await api(`/api/uploads/${batch.id}/media`,{key:files[0].key});await api(`/api/uploads/${batch.id}/media`,{key:files[0].key});
  const done=await api(`/api/uploads/${batch.id}/finish`,{});assert.equal(done.count,1);assert.equal((await api(`/api/uploads/${batch.id}/finish`,{})).path,done.path);
 }
 const rows=(await db.query('SELECT g.id,g.drive_folder_id,(SELECT count(*) FROM general_media m WHERE m.general_upload_id=g.id)::int AS files FROM general_uploads g WHERE upload_id=ANY($1::uuid[])',[ids])).rows;
 assert.equal(rows.length,2);assert.notEqual(rows[0].drive_folder_id,rows[1].drive_folder_id);assert.ok(rows.every(r=>r.files===1));
 console.info('PASS: live Drive chunk resume, upload/confirmation/finish idempotency, incomplete finish rejection, owner isolation, and separate same-title general folders.');
}catch(e){console.error(/^API_CHECK_FAILED_/.test(e.message)?e.message:'UPLOAD_INTEGRATION_FAILED');process.exitCode=1;}finally{await db.end();}
