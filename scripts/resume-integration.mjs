// Synthetic-only upload recovery acceptance. No Drive files are provisioned.
// Keep responses, identities, patient details, upload IDs and credentials out of logs.
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';

let stage='setup',db,ownerCookie,otherCookie,origin;
const fixtureUploadIds=[];

async function request(path,body,{expected=200,cookie=ownerCookie}={}){
 const response=await fetch(origin+path,{
  method:body===undefined?'GET':'POST',
  headers:{cookie,origin,'Content-Type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body),
  signal:AbortSignal.timeout(90000),
 });
 if(response.status!==expected){
  // Include only an allowlisted error code, never an API body or an exception.
  let code='UNKNOWN';
  try{const value=await response.json();if(/^[A-Z_]+$/.test(value.error??''))code=value.error;}catch{}
  throw new Error(`HTTP_${response.status}_${code}`);
 }
 assert.match(response.headers.get('cache-control')??'',/private/);
 assert.match(response.headers.get('cache-control')??'',/no-store/);
 return response;
}

async function api(path,body,options){return(await request(path,body,options)).json();}

function fixtureInput(){
 const uploadId=randomUUID();fixtureUploadIds.push(uploadId);
 return {
  uploadId,kind:'patient',firstName:'Upload recovery',lastName:'Synthetic '+randomUUID().slice(0,8),
  treatment:'Synthetic upload recovery check',date:new Date().toISOString().slice(0,10),
  description:'Generated test fixture only; no files transferred.',uploadedBy:'Automated test',
  consented:false,formOnFile:false,
  files:[{key:randomUUID(),fingerprint:'a'.repeat(64),kind:'photo',label:'other',mimeType:'image/jpeg',bytes:1024,width:640,height:480,durationS:null}],
 };
}

async function counts(uploadId){
 return(await db.query(`SELECT
  (SELECT count(*)::int FROM upload_batches WHERE id=$1) AS batches,
  (SELECT count(*)::int FROM sessions WHERE upload_id=$1) AS sessions,
  (SELECT count(*)::int FROM patients WHERE id IN (SELECT patient_id FROM sessions WHERE upload_id=$1)) AS patients`,[uploadId])).rows[0];
}

try{
 origin=process.env.APP_URL;
 assert.equal(origin,'http://localhost:3102');
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
 db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:20000});
 await db.connect();
 const clinic=(await db.query('SELECT id,drive_root_folder_id,upload_passcode_hash FROM clinics WHERE slug=$1',[process.env.CLINIC_SLUG??'dr-sands'])).rows[0];
 assert.ok(clinic);assert.equal(clinic.drive_root_folder_id,process.env.DRIVE_ROOT_FOLDER_ID);
 const ownerEmail='allowed@example.test';
 assert.ok((process.env.ALLOWED_EMAILS??'').split(',').map(value=>value.trim().toLowerCase()).includes(ownerEmail));
 const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'upload-resume-test',email:ownerEmail,verifiedGoogle:true},maxAge:3600});
 ownerCookie=`authjs.session-token=${jwt}`;

 // A second valid clinic-upload login is authorized to upload, but cannot take
 // over the Google account's remembered batch. No allowlist changes are needed.
 const secret=process.env.COOKIE_SECRET??process.env.AUTH_SECRET;
 assert.ok(secret);
 const sign=value=>createHmac('sha256',secret).update(value).digest('hex');
 const payload=Buffer.from(JSON.stringify({clinicId:clinic.id,passcodeVersion:sign(clinic.upload_passcode_hash),expires:Date.now()+3600000,id:randomUUID()})).toString('base64url');
 otherCookie=`posting-center-upload=${payload}.${sign(payload)}`;
 const unavailable={error:'UPLOAD_NOT_FOUND'};

 stage='nonexistent_remembered_batch';
 const nonexistentId=randomUUID();
 assert.deepEqual(await api(`/api/uploads/${nonexistentId}/status`,undefined,{expected:404}),unavailable);
 assert.deepEqual(await api(`/api/uploads/${nonexistentId}/status`,undefined,{expected:404,cookie:otherCookie}),unavailable);

 stage='rejected_start_has_no_record';
 const rejected=fixtureInput();rejected.date='2026-02-30';
 assert.deepEqual(await api('/api/uploads/start',rejected,{expected:400}),{error:'INVALID_DATE'});
 assert.deepEqual(await counts(rejected.uploadId),{batches:0,sessions:0,patients:0});

 stage='concurrent_start_reuses_batch';
 const input=fixtureInput();
 const [first,retry]=await Promise.all([api('/api/uploads/start',input),api('/api/uploads/start',input)]);
 assert.equal(first.id,input.uploadId);assert.deepEqual(retry,first);
 assert.deepEqual(await counts(input.uploadId),{batches:1,sessions:1,patients:1});
 assert.equal(first.finished,false);assert.ok(first.files.every(file=>!file.confirmed&&!file.driveId));

 stage='different_owner_cannot_discover_or_mutate_batch';
 assert.deepEqual(await api(`/api/uploads/${input.uploadId}/status`,undefined,{expected:404,cookie:otherCookie}),unavailable);
 assert.deepEqual(await api('/api/uploads/start',input,{expected:404,cookie:otherCookie}),unavailable);
 for(const action of ['sign','media','renew','finish']){
  assert.deepEqual(await api(`/api/uploads/${input.uploadId}/${action}`,{key:input.files[0].key},{expected:404,cookie:otherCookie}),unavailable);
 }
 assert.deepEqual(await counts(input.uploadId),{batches:1,sessions:1,patients:1});

 stage='original_account_can_resume';
 assert.deepEqual(await api(`/api/uploads/${input.uploadId}/status`),first);
 assert.deepEqual(await api('/api/uploads/start',input),first);

 stage='lost_success_response_reuses_accepted_batch';
 const ambiguous=fixtureInput();
 const discarded=await request('/api/uploads/start',ambiguous);
 // The server committed successfully, but the client never receives/reads its
 // response body. Recover with the exact original upload ID and request body.
 await discarded.body?.cancel();
 const accepted=(await db.query('SELECT id,patient_id FROM sessions WHERE upload_id=$1',[ambiguous.uploadId])).rows[0];
 assert.ok(accepted);
 const recovered=await api('/api/uploads/start',ambiguous);
 assert.equal(recovered.id,ambiguous.uploadId);assert.equal(recovered.patient.id,accepted.patient_id);
 const resumed=await api(`/api/uploads/${ambiguous.uploadId}/status`);
 assert.deepEqual(resumed,recovered);
 assert.deepEqual(await counts(ambiguous.uploadId),{batches:1,sessions:1,patients:1});
 assert.deepEqual((await db.query('SELECT id,patient_id FROM sessions WHERE upload_id=$1',[ambiguous.uploadId])).rows[0],accepted);

 stage='no_private_storage_side_effects';
 const untouched=(await db.query(`SELECT
  count(*)::int AS batches,
  bool_and(b.photos_folder_id IS NULL AND b.videos_folder_id IS NULL AND s.drive_folder_id IS NULL AND s.finished_at IS NULL) AS pending,
  (SELECT count(*)::int FROM media WHERE session_id IN (SELECT id FROM sessions WHERE upload_id=ANY($1::uuid[]))) AS media,
  (SELECT count(*)::int FROM consent_events WHERE session_id IN (SELECT id FROM sessions WHERE upload_id=ANY($1::uuid[]))) AS consent
  FROM upload_batches b JOIN sessions s ON s.id=b.session_id WHERE b.id=ANY($1::uuid[])`,[fixtureUploadIds])).rows[0];
 assert.deepEqual(untouched,{batches:2,pending:true,media:0,consent:0});
 console.info('PASS: missing remembered batch, cross-owner 404 isolation, original-account resume, concurrent start idempotency, rejected start creates no records, and lost start response recovery without duplicate patients or sessions.');
}catch(error){
 console.error('UPLOAD_RESUME_CHECK_FAILED_'+stage+(/^HTTP_[A-Z0-9_]+$/.test(error?.message??'')?'_'+error.message:''));
 process.exitCode=1;
}finally{
 if(db){
  try{
   // Archive only this execution's generated patients, retaining audit history.
   // Discover by random IDs so an accepted-but-lost response is also cleaned up.
   const patients=(await db.query('SELECT DISTINCT patient_id FROM sessions WHERE upload_id=ANY($1::uuid[])',[fixtureUploadIds])).rows;
   for(const {patient_id:patientId} of patients){
    const archived=await api(`/api/patients/${patientId}`,{action:'archive'});
    assert.ok(archived.archivedAt);
   }
   console.info('SYNTHETIC_RESUME_FIXTURES_ARCHIVED');
  }catch{
   console.error('UPLOAD_RESUME_FIXTURE_ARCHIVE_FAILED');process.exitCode=1;
  }
  await db.end().catch(()=>{});
 }
}
