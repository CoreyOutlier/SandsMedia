// Real Drive/HTTP acceptance, isolated to the synthetic database and test root.
// Errors are stage codes only: never emit bodies, names, tokens or Drive metadata.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {Readable} from 'node:stream';
import {inflateRawSync} from 'node:zlib';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
import {drive as createDrive,auth as googleAuth} from 'googleapis/build/src/apis/drive/index.js';
import {anonymousJpeg} from '../src/lib/portal/jpeg.ts';

let stage='isolation',db,drive,origin,ownerCookie,passcodeCookie,deniedCookie;
let preserve=false;
const mode=process.argv[2]??'verify';
const key=randomUUID().replaceAll('-','');
const name=`Anonymous${key}`;
const metadataSecret=`PRIVATE_METADATA_${key}`;
const folders=new Set(),patients=new Set();
const expectStatus=(actual,expected)=>assert.ok((Array.isArray(expected)?expected:[expected]).includes(actual),`HTTP_${actual}`);
async function response(path,body,{expected=200,cookie=ownerCookie,requestOrigin=origin}={}){
 const result=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:requestOrigin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 if(!(Array.isArray(expected)?expected:[expected]).includes(result.status)){let code='';try{const failed=await result.clone().json();if(/^[A-Z_]+$/.test(failed.error??''))code='_'+failed.error;}catch{}throw new Error(`HTTP_${result.status}${code}`);}assert.match(result.headers.get('cache-control')??'',/no-store/);return result;
}
async function api(path,body,options){return(await response(path,body,options)).json();}
async function denied(path,body,options={}){const result=await api(path,body,{expected:404,...options});assert.match(result.error,/^[A-Z_]+$/);assert.ok(!JSON.stringify(result).includes(name));return result;}
async function bytes(path,options){return Buffer.from(await(await response(path,undefined,options)).arrayBuffer());}
function withMetadata(jpeg){
 const payload=Buffer.from(metadataSecret);const length=Buffer.alloc(2);length.writeUInt16BE(payload.length+2);
 return Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225]),length,payload,Buffer.from([255,254]),length,payload,jpeg.subarray(2),payload]);
}
function zipEntries(zip){
 const end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);
 let at=zip.readUInt32LE(end+16);const count=zip.readUInt16LE(end+10);const entries=[];
 for(let index=0;index<count;index++){
  assert.equal(zip.readUInt32LE(at),0x02014b50);const method=zip.readUInt16LE(at+10),size=zip.readUInt32LE(at+20),nameLength=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),offset=zip.readUInt32LE(at+42);
  const entryName=zip.subarray(at+46,at+46+nameLength).toString();assert.equal(zip.readUInt32LE(offset),0x04034b50);
  const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);const compressed=zip.subarray(start,start+size);
  assert.ok([0,8].includes(method));entries.push({name:entryName,bytes:method===0?compressed:inflateRawSync(compressed)});at+=46+nameLength+extra+comment;
 }return entries;
}
const approvalBody=(approved=true,requestId=randomUUID())=>({approved,confirmed:true,policyVersion:1,requestId});
async function review(id){return api(`/api/media/${id}/anonymous-use`);}
async function approve(id,approved=true,requestId=randomUUID()){
 const proof=approved?await review(id):null;
 return api(`/api/media/${id}/anonymous-use`,{...approvalBody(approved,requestId),...(proof?{reviewToken:proof.reviewToken}:{})});
}
async function upload(buffers,kinds,anonymousFlags,options={}){
 const files=buffers.map((buffer,index)=>({key:randomUUID(),fingerprint:createHash('sha256').update(buffer).digest('hex'),contentChecksum:kinds[index]==='photo'?(options.contentChecksum??createHash('sha256').update(buffer).digest('hex')):undefined,kind:kinds[index],label:index===0?'before':kinds[index]==='video'?'testimonial':'after',mimeType:kinds[index]==='video'?'video/mp4':'image/jpeg',bytes:buffer.length,width:640,height:480,durationS:kinds[index]==='video'?2:null,title:kinds[index]==='video'?'PRIVATE_VIDEO_TITLE':null,anonymousApproved:anonymousFlags[index]}));
 const input={uploadId:randomUUID(),kind:'patient',firstName:name,lastName:'Synthetic',patientId:options.patientId,treatment:'PRIVATE_TREATMENT',date:'2026-11-05',description:'PRIVATE_DESCRIPTION',uploadedBy:'PRIVATE_UPLOADER',consented:options.consented??false,formOnFile:options.consented??false,policyVersion:1,files};
 const cookie=options.cookie??passcodeCookie;
 const batch=await api('/api/uploads/start',input,{cookie});patients.add(batch.patient.id);
 if(options.afterStart)await options.afterStart(batch.patient.id);
 for(let index=0;index<files.length;index++){
  stage=`fixture_${index}_upload`;
  const signed=await api(`/api/uploads/${batch.id}/sign`,{key:files[index].key},{cookie});
  const folder=(await db.query('SELECT drive_folder_id FROM patients WHERE id=$1',[batch.patient.id])).rows[0].drive_folder_id;if(folder)folders.add(folder);
  const transferred=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':files[index].mimeType,'Content-Range':`bytes 0-${buffers[index].length-1}/${buffers[index].length}`},body:buffers[index],signal:AbortSignal.timeout(90000)});
  expectStatus(transferred.status,[200,201]);await transferred.body?.cancel();
  await api(`/api/uploads/${batch.id}/media`,{key:files[index].key},{cookie});
 }
 stage='fixture_finish';const finished=await api(`/api/uploads/${batch.id}/finish`,{},{cookie});
 stage='fixture_finish_count';assert.equal(finished.anonymousCount,options.expectedAnonymousCount??anonymousFlags.filter(Boolean).length);
 stage='fixture_detail';const detail=await api(`/api/patients/${batch.patient.id}`);
 const session=detail.sessions.find(item=>item.media.length===files.length&&item.finished);
 stage='fixture_session';assert.ok(session);return{batch,detail,session,files,input};
}
async function newShare(patientId,mediaIds,extra={}){
 const result=await api('/api/shares',{patientId,mode:'anonymous',mediaIds,days:1,...extra});
 const token=new URL(result.url).pathname.split('/').pop();
 const row=(await db.query('SELECT id FROM share_links WHERE token_hash=$1',[createHash('sha256').update(token).digest('hex')])).rows[0];
 assert.ok(row);return{token,id:row.id,path:new URL(result.url).pathname};
}
const shareView=(share,cookie='')=>api('/api/share-view',{token:share.token,refresh:true},{cookie});
async function cannotShare(share,previous){
 await denied('/api/share-view',{token:share.token,refresh:true},{cookie:'',expected:[403,404]});
 for(const path of [previous.photos[0].thumbnail,previous.photos[0].stream,previous.photos[0].download,previous.download])await denied(path,undefined,{cookie:'',expected:[403,404]});
}
const consentRows=async patientId=>(await db.query('SELECT c.* FROM consent_events c JOIN sessions s ON s.id=c.session_id WHERE s.patient_id=$1 ORDER BY c.id',[patientId])).rows;
const events=async patientId=>(await db.query('SELECT e.* FROM media_use_events e JOIN media m ON m.id=e.media_id JOIN sessions s ON s.id=m.session_id WHERE s.patient_id=$1 ORDER BY e.id',[patientId])).rows;

try{
 assert.ok(['verify','--prepare-ui'].includes(mode));origin=process.env.APP_URL;assert.equal(origin,'http://localhost:3102');
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');assert.ok((process.env.ALLOWED_EMAILS??'').split(',').includes('allowed@example.test'));
 const production=parseEnv(await readFile(new URL('../.env.upload-production',import.meta.url),'utf8'));assert.ok(process.env.DRIVE_ROOT_FOLDER_ID);assert.notEqual(process.env.DRIVE_ROOT_FOLDER_ID,production.DRIVE_ROOT_FOLDER_ID);
 db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});await db.connect();assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name,'sandsmedia_upload_test');
 const clinic=(await db.query('SELECT id,drive_root_folder_id,upload_passcode_hash FROM clinics WHERE slug=$1',[process.env.CLINIC_SLUG??'dr-sands'])).rows[0];assert.ok(clinic);assert.equal(clinic.drive_root_folder_id,process.env.DRIVE_ROOT_FOLDER_ID);
 const credentials=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON,'base64').toString());drive=createDrive({version:'v3',auth:new googleAuth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/drive']})});
 const root=(await drive.files.get({fileId:clinic.drive_root_folder_id,supportsAllDrives:true,fields:'name,trashed'})).data;assert.ok(!root.trashed&&/test|synthetic/i.test(root.name??''));
 const cookieFor=async email=>`authjs.session-token=${await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'anonymous-test',email,verifiedGoogle:true},maxAge:3600})}`;
 ownerCookie=await cookieFor('allowed@example.test');deniedCookie=await cookieFor('not-allowed@example.test');
 const sign=value=>createHmac('sha256',process.env.COOKIE_SECRET??process.env.AUTH_SECRET).update(value).digest('hex');
 const payload=Buffer.from(JSON.stringify({clinicId:clinic.id,passcodeVersion:sign(clinic.upload_passcode_hash),expires:Date.now()+3600000,id:randomUUID()})).toString('base64url');passcodeCookie=`posting-center-upload=${payload}.${sign(payload)}`;
 const originals=await Promise.all(['photo-1.jpg','photo-2.jpg','synthetic-video.mp4'].map(file=>readFile(new URL(`../qa/upload-fixtures/${file}`,import.meta.url))));
 const fixture=await upload([withMetadata(originals[0]),originals[1],originals[2]],['photo','photo','video'],[true,false,false]);
 stage='fixture_media_order';const patientId=fixture.detail.id;const [photo,privatePhoto,video]=fixture.session.media;assert.equal(photo.kind,'photo');assert.equal(privatePhoto.kind,'photo');assert.equal(video.kind,'video');
 stage='fixture_approval_dto';assert.equal(photo.anonymousUse.approved,true);assert.equal(privatePhoto.anonymousUse.approved,false);assert.equal(video.anonymousUse.approved,false);assert.equal(fixture.session.consented,false);
 stage='fixture_approval_audit';assert.equal((await consentRows(patientId)).length,0);assert.equal((await events(patientId)).length,1);
 stage='fixture_share';let share;try{share=await newShare(patientId,[photo.id]);}catch(error){const review=(await db.query('SELECT e.drive_version,e.md5_checksum,m.drive_file_id,m.bytes,u.photos_folder_id,u.manifest,u.id AS batch_id FROM media_use_events e JOIN media m ON m.id=e.media_id JOIN sessions s ON s.id=m.session_id JOIN upload_batches u ON u.session_id=s.id WHERE m.id=$1 ORDER BY e.version DESC LIMIT 1',[photo.id])).rows[0];const meta=(await drive.files.get({fileId:review.drive_file_id,supportsAllDrives:true,fields:'headRevisionId,md5Checksum,mimeType,size,parents,appProperties,trashed'})).data;const plan=review.manifest.find(item=>item.driveId===review.drive_file_id);console.info('SYNTHETIC_SNAPSHOT_MATCHES_'+JSON.stringify({contentRevision:meta.headRevisionId===review.drive_version,md5:meta.md5Checksum===review.md5_checksum,size:Number(meta.size)===Number(review.bytes),parent:meta.parents?.[0]===review.photos_folder_id,key:meta.appProperties?.postingCenterKey===`file:${review.batch_id}:${plan.key}`,trashed:!!meta.trashed}));throw error;}const publicData=await shareView(share);
 if(mode==='--prepare-ui'){
  await writeFile(new URL('../qa/anonymous-ui-fixtures.json',import.meta.url),JSON.stringify({patientId,patientPath:`/patients?patient=${patientId}`,sharePath:share.path,photoId:photo.id,privatePhotoId:privatePhoto.id,search:name}),{mode:0o600});preserve=true;console.info('SYNTHETIC_ANONYMOUS_UI_FIXTURES_READY');
 }else{
 stage='permissions_selection';
 for(const cookie of ['',passcodeCookie,deniedCookie]){await denied('/api/shares',{patientId,mode:'anonymous',mediaIds:[photo.id]},{cookie,expected:401});await denied(`/api/media/${photo.id}/anonymous-use`,approvalBody(),{cookie,expected:401});}
 await denied(`/api/media/${photo.id}/anonymous-use`,approvalBody(),{requestOrigin:'https://invalid.example.test',expected:403});
 for(const body of [{...approvalBody(),confirmed:false},{...approvalBody(),policyVersion:2},{...approvalBody(),approved:'true'}])await denied(`/api/media/${photo.id}/anonymous-use`,body,{expected:400});
 await denied('/api/shares',{patientId},{expected:409});
 for(const selection of [[],[photo.id,photo.id],['invalid']])await denied('/api/shares',{patientId,mode:'anonymous',mediaIds:selection},{expected:400});
 for(const selection of [[privatePhoto.id],[video.id],[photo.id,privatePhoto.id]])await denied('/api/shares',{patientId,mode:'anonymous',mediaIds:selection},{expected:409});
 await denied(`/api/media/${video.id}/anonymous-use`,undefined,{expected:404});
 const scopeReview=await review(photo.id);
 const missingReview=await denied(`/api/media/${privatePhoto.id}/anonymous-use`,approvalBody(),{expected:409});assert.equal(missingReview.error,'ANONYMOUS_REVIEW_REQUIRED');
 await denied(`/api/media/${privatePhoto.id}/anonymous-use`,{...approvalBody(),reviewToken:scopeReview.reviewToken},{expected:409});
 await denied(scopeReview.preview,undefined,{cookie:'',expected:401});

 stage='public_payload_bytes_zip';
 assert.deepEqual(Object.keys(publicData),['mode','expiresAt','download','photos']);assert.equal(publicData.mode,'anonymous');assert.equal(publicData.photos.length,1);assert.equal(publicData.photos[0].id,photo.id);
 const serialized=JSON.stringify(publicData);for(const secret of [name,patientId,fixture.session.id,fixture.detail.displayId,'PRIVATE_TREATMENT','PRIVATE_DESCRIPTION','PRIVATE_UPLOADER','PRIVATE_VIDEO_TITLE','2026-11-05'])assert.ok(!serialized.includes(secret));
 const page=await fetch(origin+share.path);expectStatus(page.status,200);const html=await page.text();for(const secret of [name,patientId,fixture.session.id,fixture.detail.displayId,'PRIVATE_TREATMENT','PRIVATE_UPLOADER'])assert.ok(!html.includes(secret));
 const sanitized=anonymousJpeg(withMetadata(originals[0]));
 for(const path of [publicData.photos[0].thumbnail,publicData.photos[0].stream,publicData.photos[0].download])assert.deepEqual(await bytes(path,{cookie:''}),sanitized);
 const downloadResponse=await response(publicData.photos[0].download,undefined,{cookie:''});assert.match(downloadResponse.headers.get('content-disposition'),/photo-01\.jpg/);await downloadResponse.body?.cancel();
 assert.deepEqual(await bytes(`/api/media/${photo.id}/anonymous-download`),sanitized);await denied(`/api/media/${privatePhoto.id}/anonymous-download`,undefined,{expected:409});
 const raw=await bytes(photo.download);assert.ok(raw.includes(Buffer.from(metadataSecret)));
 const zip=await bytes(publicData.download,{cookie:''});const entries=zipEntries(zip);assert.deepEqual(entries.map(entry=>entry.name),['photo-01.jpg']);assert.deepEqual(entries[0].bytes,sanitized);assert.ok(!zip.includes(Buffer.from(metadataSecret)));
 for(const other of [privatePhoto,video])for(const action of ['thumbnail','stream','download'])await denied(publicData.photos[0][action==='thumbnail'?'thumbnail':action==='stream'?'stream':'download'].replace(photo.id,other.id),undefined,{cookie:'',expected:404});
 console.info('ANONYMOUS_UPLOAD_SELECTION_PAYLOAD_EXPORTS_PASSED');

 stage='fixed_selection_approval_idempotency';
 const later=await upload([originals[1]],['photo'],[true],{patientId});stage='fixed_selection_later_upload';
 assert.equal((await shareView(share)).photos.length,1);
 await denied(publicData.photos[0].download.replace(photo.id,later.session.media[0].id),undefined,{cookie:'',expected:404});
 stage='anonymous_session_posted_filter';
 await denied(`/api/patients/${patientId}`,{action:'status',sessionId:fixture.session.id,status:'posted'},{expected:409});
 await api(`/api/patients/${patientId}`,{action:'status',sessionId:later.session.id,status:'ready'});
 const posted=await api(`/api/patients/${patientId}`,{action:'status',sessionId:later.session.id,status:'posted'});
 assert.equal(posted.sessions.find(session=>session.id===later.session.id).status,'posted');
 assert.ok((await api('/api/library',{q:fixture.detail.displayId,filter:'posted'})).rows.some(row=>row.id===patientId));
 stage='fixed_selection_approval_idempotency';
 const requestId=randomUUID();await approve(privatePhoto.id,true,requestId);await approve(privatePhoto.id,true,requestId);
 assert.equal((await events(patientId)).filter(event=>event.media_id===privatePhoto.id).length,1);
 assert.equal((await shareView(share)).photos.length,1);
 const two=await newShare(patientId,[privatePhoto.id,photo.id]);const twoData=await shareView(two);assert.deepEqual(twoData.photos.map(item=>item.id),[privatePhoto.id,photo.id]);
 await approve(photo.id,false);await cannotShare(share,publicData);await cannotShare(two,twoData);
 await approve(photo.id,true);await cannotShare(share,publicData);
 assert.equal((await consentRows(patientId)).length,0);

 stage='pin_expiry_and_revoke';
 const pinned=await newShare(patientId,[photo.id],{pin:'4826'});await denied('/api/share-view',{token:pinned.token,refresh:true},{cookie:'',expected:401});
 await denied('/api/share-access',{token:pinned.token,pin:'0000'},{cookie:'',expected:401});
 const unlocked=await response('/api/share-access',{token:pinned.token,pin:'4826'},{cookie:''});const pinCookie=unlocked.headers.get('set-cookie')?.split(';')[0];assert.ok(pinCookie);await unlocked.body?.cancel();
 const pinData=await shareView(pinned,pinCookie);assert.equal(pinData.photos.length,1);
 await api(`/api/shares/${pinned.id}`,{});await cannotShare(pinned,pinData);
 const expires=await newShare(patientId,[photo.id]);const expiresData=await shareView(expires);await db.query('UPDATE share_links SET expires_at=created_at+INTERVAL \'1 millisecond\' WHERE id=$1',[expires.id]);await cannotShare(expires,expiresData);

 stage='drive_revision_binding';
 const changed=await newShare(patientId,[photo.id]);const changedData=await shareView(changed);
 const staleReview=await review(photo.id);assert.equal(typeof staleReview.reviewToken,'string');assert.deepEqual(await bytes(staleReview.preview),sanitized);
 const driveId=(await db.query('SELECT drive_file_id FROM media WHERE id=$1',[photo.id])).rows[0].drive_file_id;
 // Alter only a generated metadata byte while preserving a valid JPEG and its
 // exact size. The approved source checksum must reject this new content.
 const altered=withMetadata(originals[0]);const markerAt=altered.indexOf(Buffer.from(metadataSecret));assert.ok(markerAt>0);altered[markerAt]^=1;
 await drive.files.update({fileId:driveId,supportsAllDrives:true,media:{mimeType:'image/jpeg',body:Readable.from([altered])},fields:'id'});
 const staleResult=await denied(`/api/media/${photo.id}/anonymous-use`,{...approvalBody(),reviewToken:staleReview.reviewToken},{expected:409});assert.equal(staleResult.error,'ANONYMOUS_REVIEW_STALE');
 await denied(staleReview.preview,undefined,{expected:409});
 for(const path of [changedData.photos[0].thumbnail,changedData.photos[0].download,changedData.download])await denied(path,undefined,{cookie:'',expected:409});
 await denied('/api/shares',{patientId,mode:'anonymous',mediaIds:[photo.id]},{expected:409});
 await approve(photo.id,true);await cannotShare(changed,changedData);
 console.info('ANONYMOUS_APPROVAL_REVOKE_PIN_EXPIRY_REVISION_CHECKS_PASSED');

 stage='archive_restore_lifecycle';
 const archiveShare=await newShare(patientId,[photo.id]);const archiveData=await shareView(archiveShare);
 const preArchiveReview=await review(photo.id);
 await api(`/api/patients/${patientId}`,{action:'archive'});await cannotShare(archiveShare,archiveData);
 await api(`/api/patients/${patientId}`,{action:'restore'});await cannotShare(archiveShare,archiveData);await denied(`/api/media/${photo.id}/anonymous-download`,undefined,{expected:409});
 await denied(`/api/media/${photo.id}/anonymous-use`,{...approvalBody(),reviewToken:preArchiveReview.reviewToken},{expected:409});
 await approve(photo.id,true);
 stage='withdrawal_lifecycle';const withdrawn=await newShare(patientId,[photo.id]);const withdrawnData=await shareView(withdrawn);
 await api(`/api/patients/${patientId}`,{action:'withdraw'});await cannotShare(withdrawn,withdrawnData);await denied(`/api/media/${photo.id}/anonymous-use`,approvalBody(),{expected:409});
 assert.equal((await consentRows(patientId)).length,0);

 stage='deletion_lifecycle';
 const deletionFixture=await upload([originals[0]],['photo'],[true],{cookie:ownerCookie});const deletedPhoto=deletionFixture.session.media[0];
 const deletedShare=await newShare(deletionFixture.detail.id,[deletedPhoto.id]);const deletedData=await shareView(deletedShare);const retained=await events(deletionFixture.detail.id);
 await api(`/api/patients/${deletionFixture.detail.id}/delete`,{confirmed:true});await cannotShare(deletedShare,deletedData);assert.deepEqual(await events(deletionFixture.detail.id),retained);

 stage='pending_upload_lifecycle';
 const pending=await upload([originals[0]],['photo'],[true],{cookie:ownerCookie,expectedAnonymousCount:0,afterStart:async id=>{await api(`/api/patients/${id}`,{action:'archive'});await api(`/api/patients/${id}`,{action:'restore'});}});
 assert.equal(pending.session.media[0].anonymousUse.approved,false);assert.equal((await events(pending.detail.id)).length,0);assert.equal((await consentRows(pending.detail.id)).length,0);
 assert.deepEqual(await bytes(pending.session.media[0].download),originals[0]);

 stage='upload_reviewed_bytes_binding';
 const wrongBytes=await upload([originals[0]],['photo'],[true],{cookie:ownerCookie,contentChecksum:'0'.repeat(64),expectedAnonymousCount:0});
 assert.equal(wrongBytes.session.media[0].anonymousUse.approved,false);assert.equal((await events(wrongBytes.detail.id)).length,0);assert.deepEqual(await bytes(wrongBytes.session.media[0].download),originals[0]);

 stage='named_link_consent_boundary';
 const namedFixture=await upload([originals[0]],['photo'],[false],{cookie:ownerCookie,consented:true});
 const namedResult=await api('/api/shares',{patientId:namedFixture.detail.id,days:1});const namedToken=new URL(namedResult.url).pathname.split('/').pop();
 const anonymousAddition=await upload([originals[1]],['photo'],[true],{cookie:ownerCookie,patientId:namedFixture.detail.id});stage='named_link_consent_boundary';
 const namedData=await api('/api/share-view',{token:namedToken,refresh:true},{cookie:''});assert.equal(namedData.mode,'consented');
 assert.deepEqual(namedData.sessions.flatMap(session=>session.media).map(item=>item.id),[namedFixture.session.media[0].id]);
 await denied(namedData.sessions[0].media[0].download.replace(namedFixture.session.media[0].id,anonymousAddition.session.media[0].id),undefined,{cookie:'',expected:404});
 const anonymousOnly=await newShare(namedFixture.detail.id,[anonymousAddition.session.media[0].id]);assert.equal((await shareView(anonymousOnly)).photos.length,1);

 stage='immutable_audit_permissions';
 for(const table of ['consent_events','patient_activities','media_use_events','share_photos']){
  const permissions=(await db.query("SELECT has_table_privilege(current_user,$1,'SELECT') AS read,has_table_privilege(current_user,$1,'INSERT') AS append,has_table_privilege(current_user,$1,'UPDATE,DELETE,TRUNCATE') AS mutate",[table])).rows[0];assert.deepEqual(permissions,{read:true,append:true,mutate:false});
 }
 assert.equal((await consentRows(patientId)).length,0);
 console.info('ANONYMOUS_INTEGRATION_PASS_UPLOAD_PASSCODE_MIXED_SELECTION_NO_CONSENT_PUBLIC_ALLOWLIST_SANITIZED_BYTES_GENERIC_ZIP_APPROVAL_REVOKE_REAPPROVE_PIN_EXPIRY_REVISION_ARCHIVE_WITHDRAW_DELETE_APPEND_ONLY');
 }
}catch(error){const code=/^HTTP_[0-9]+(?:_[A-Z_]+)?$/.test(error?.message??'')?`_${error.message}`:/^[0-9A-Z]{5}$/.test(error?.code??'')?`_DATABASE_${error.code}`:'';console.error(`ANONYMOUS_INTEGRATION_FAILED_${stage.toUpperCase()}${code}`);process.exitCode=1;}
finally{
 if(db){try{if(!preserve){if(patients.size)await db.query('UPDATE patients SET archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP) WHERE id=ANY($1::uuid[])',[[...patients]]);if(drive)for(const fileId of folders)await drive.files.update({fileId,supportsAllDrives:true,requestBody:{trashed:true},fields:'id'});if(patients.size)console.info('SYNTHETIC_ANONYMOUS_FIXTURE_FOLDERS_TRASHED_AUDIT_RETAINED');}}catch{console.error('ANONYMOUS_FIXTURE_CLEANUP_FAILED');process.exitCode=1;}await db.end().catch(()=>{});}
}
