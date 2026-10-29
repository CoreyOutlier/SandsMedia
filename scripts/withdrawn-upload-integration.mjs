// Synthetic-only acceptance: private storage remains available after social
// consent is withdrawn. Never print API bodies, identities, names or signed URLs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';

const origin=process.env.APP_URL;
assert.equal(origin,'http://localhost:3102');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});
const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'withdrawn-upload-test',email:'allowed@example.test',verifiedGoogle:true},maxAge:3600});
const cookie=`authjs.session-token=${jwt}`;
let stage='setup',patientId,retries=0;
async function call(path,body,expected=200,authenticated=true,retried=false){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie:authenticated?cookie:'',origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 if(response.status===503&&expected===200&&!retried&&(path.startsWith('/api/uploads/')||body?.action==='withdraw')){
  await response.arrayBuffer();retries++;return call(path,body,expected,authenticated,true);
 }
 if(response.status!==expected){
  let code='UNKNOWN';try{const data=await response.json();if(/^[A-Z_]+$/.test(data.error??''))code=data.error;}catch{}
  const endpoint=path.startsWith('/api/uploads/')?path.split('/').at(-1).toUpperCase():'PORTAL';
  throw new Error(`HTTP_${response.status}_${code}_${endpoint}`);
 }
 return response;
}
async function api(path,body,expected=200,authenticated=true){return(await call(path,body,expected,authenticated)).json();}
const snapshot=async()=> (await db.query('SELECT consent_withdrawn_at,lifecycle_version FROM patients WHERE id=$1',[patientId])).rows[0];
const events=async()=> (await db.query('SELECT c.* FROM consent_events c JOIN sessions s ON s.id=c.session_id WHERE s.patient_id=$1 ORDER BY c.id',[patientId])).rows;
const session=async batchId=>(await db.query('SELECT id,status,finished_at FROM sessions WHERE upload_id=$1',[batchId])).rows[0];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

try{
 await db.connect();
 const clinic=(await db.query('SELECT drive_root_folder_id FROM clinics WHERE slug=$1',[process.env.CLINIC_SLUG??'dr-sands'])).rows[0];
 assert.equal(clinic?.drive_root_folder_id,process.env.DRIVE_ROOT_FOLDER_ID);
 const photo=await readFile(new URL('../qa/upload-fixtures/photo-1.jpg',import.meta.url));
 const video=await readFile(new URL('../qa/upload-fixtures/synthetic-video.mp4',import.meta.url));
 const photoPlan=()=>({key:randomUUID(),fingerprint:digest(photo),kind:'photo',label:'other',mimeType:'image/jpeg',bytes:photo.length,width:640,height:480,durationS:null});
 const videoPlan=()=>({key:randomUUID(),fingerprint:digest(video),kind:'video',label:'other',mimeType:'video/mp4',bytes:video.length,width:640,height:480,durationS:2,title:'Synthetic private footage'});
 const input=(files,consented)=>({uploadId:randomUUID(),kind:'patient',...(patientId?{patientId}:{firstName:'Private storage',lastName:'Synthetic '+randomUUID().slice(0,8)}),treatment:'Synthetic storage policy verification',date:new Date().toISOString().slice(0,10),description:'Generated fixture only',uploadedBy:'Automated test',consented,formOnFile:consented,files});
 async function upload(batch,plans,{withdrawn=false,renew=false}={}){
  const initial=await api(`/api/uploads/${batch.id}/status`);
  assert.equal(initial.patient.consentWithdrawn,withdrawn);
  await api(`/api/uploads/${batch.id}/finish`,{},409);
  for(const plan of plans){
   let signed=await api(`/api/uploads/${batch.id}/sign`,{key:plan.key});
   assert.equal((await api(`/api/uploads/${batch.id}/sign`,{key:plan.key})).url,signed.url);
   if(renew){
    assert.equal((await api(`/api/uploads/${batch.id}/renew`,{key:plan.key})).renewed,true);
    const renewed=await api(`/api/uploads/${batch.id}/sign`,{key:plan.key});
    assert.equal(renewed.driveId,signed.driveId);assert.ok(renewed.url);signed=renewed;
   }
   const response=await fetch(signed.url,{method:'PUT',headers:{'Content-Type':plan.mimeType,'Content-Range':`bytes 0-${plan.bytes-1}/${plan.bytes}`},body:plan.kind==='photo'?photo:video,signal:AbortSignal.timeout(60000)});
   assert.ok([200,201].includes(response.status));
   for(let retry=0;retry<2;retry++)assert.equal((await api(`/api/uploads/${batch.id}/media`,{key:plan.key})).confirmed,true);
  }
  const completed=await api(`/api/uploads/${batch.id}/finish`,{});
  assert.equal(completed.count,plans.length);assert.equal(completed.consentWithdrawn,withdrawn);
  assert.equal((await api(`/api/uploads/${batch.id}/finish`,{})).count,plans.length);
  const state=await api(`/api/uploads/${batch.id}/status`);assert.equal(state.finished,true);assert.ok(state.files.every(file=>file.confirmed));
  assert.equal((await session(batch.id)).status,withdrawn?'hold':'ready');
 }

 stage='initial_synthetic_upload';
 const baselineInput=input([photoPlan()],true),baseline=await api('/api/uploads/start',baselineInput);patientId=baseline.patient.id;
 await upload(baseline,baselineInput.files);
 const link=await api('/api/shares',{patientId,days:1});const token=new URL(link.url).pathname.split('/').pop();
 const shared=await api('/api/share-view',{token},200,false);const oldPublicStream=shared.sessions[0].media[0].stream;

 // A batch already started before withdrawal must also continue privately.
 stage='pending_batch_before_withdrawal';
 const pendingInput=input([videoPlan()],true),pending=await api('/api/uploads/start',pendingInput);
 const withdrawn=await api(`/api/patients/${patientId}`,{action:'withdraw'});assert.equal(withdrawn.clearance.status,'withdrawn');
 const before=snapshot(),oldEvents=await events();
 const withdrawalState=await before;assert.ok(withdrawalState.consent_withdrawn_at);
 stage='resume_after_withdrawal';
 const reused=await api('/api/uploads/start',pendingInput);assert.equal(reused.id,pending.id);assert.equal(reused.patient.consentWithdrawn,true);
 await upload(pending,pendingInput.files,{withdrawn:true,renew:true});
 assert.deepEqual(await snapshot(),withdrawalState);

 stage='new_mixed_private_upload';
 const privateInput=input([photoPlan(),videoPlan()],false),privateBatch=await api('/api/uploads/start',privateInput);
 assert.equal(privateBatch.patient.consentWithdrawn,true);assert.equal(privateBatch.consented,false);
 await upload(privateBatch,privateInput.files,{withdrawn:true,renew:true});
 assert.equal((await db.query('SELECT count(*)::int AS count FROM consent_events WHERE session_id=$1',[(await session(privateBatch.id)).id])).rows[0].count,0);

 // Even a fresh checked session cannot silently renew the patient withdrawal.
 stage='checked_upload_preserves_withdrawal';
 const checkedInput=input([photoPlan()],true),checked=await api('/api/uploads/start',checkedInput);
 await upload(checked,checkedInput.files,{withdrawn:true});
 assert.deepEqual(await snapshot(),withdrawalState);
 const currentEvents=await events();assert.equal(currentEvents.length,oldEvents.length+2);
 for(const event of oldEvents)assert.deepEqual(currentEvents.find(current=>current.id===event.id),event);
 assert.equal((await db.query("SELECT count(*)::int AS count FROM patient_activities WHERE patient_id=$1 AND action IN ('renewal_recorded','consent_renewed')",[patientId])).rows[0].count,0);

 stage='social_access_remains_blocked';
 const detail=await api(`/api/patients/${patientId}`);assert.equal(detail.clearance.status,'withdrawn');assert.ok(detail.links.every(item=>item.revokedAt));
 await api('/api/shares',{patientId,days:1},409);
 await api('/api/share-view',{token},404,false);await call(oldPublicStream,undefined,403,false);
 for(const status of ['ready','posted'])await api(`/api/patients/${patientId}`,{action:'status',sessionId:(await session(privateBatch.id)).id,status},409);
 assert.equal((await session(privateBatch.id)).status,'hold');
 const privateSessionId=(await session(privateBatch.id)).id;
 const privateSession=detail.sessions.find(item=>item.id===privateSessionId);
 assert.ok(privateSession);assert.deepEqual(privateSession.media.map(item=>item.kind).sort(),['photo','video']);
 for(const media of privateSession.media){
  await call(media.download,undefined,401,false);
  const download=await call(media.download);assert.ok(download.headers.get('content-disposition').includes('attachment'));
  assert.equal(digest(Buffer.from(await download.arrayBuffer())),digest(media.kind==='photo'?photo:video));
 }

 stage='archive_still_blocks_uploads';
 await api(`/api/patients/${patientId}`,{action:'archive'});
 await api('/api/uploads/start',input([photoPlan()],false),409);
 await api(`/api/uploads/${privateBatch.id}/status`,undefined,409);
 for(const action of ['sign','media','renew','finish'])await api(`/api/uploads/${privateBatch.id}/${action}`,{key:privateInput.files[0].key},409);
 const archived=await snapshot();assert.deepEqual(archived.consent_withdrawn_at,withdrawalState.consent_withdrawn_at);
 console.info('PASS: private photo/video uploads after withdrawal, paused-batch continuation, resumable-session renewal, idempotent completion, immutable prior consent, social sharing/posting blocked, authenticated originals, and archived upload rejection.');
}catch(error){
 console.error('WITHDRAWN_UPLOAD_CHECK_FAILED_'+stage+(/^HTTP_[A-Z0-9_]+$/.test(error.message)?'_'+error.message:''));process.exitCode=1;
}finally{console.info('CLIENT_EQUIVALENT_RETRIES_'+retries);await db.end();}
