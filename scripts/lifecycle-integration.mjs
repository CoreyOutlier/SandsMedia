// Synthetic-only lifecycle acceptance. Never print identities, tokens or filenames.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
import {drive as createDrive,auth as googleAuth} from 'googleapis/build/src/apis/drive/index.js';
assert.equal(process.env.APP_URL,'http://localhost:3102');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'lifecycle-test',email:'allowed@example.test',verifiedGoogle:true},maxAge:3600});
const cookie=`authjs.session-token=${jwt}`,origin=process.env.APP_URL;
const credentials=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON,'base64').toString());
const drive=createDrive({version:'v3',auth:new googleAuth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/drive']})});
let retries=0;
async function call(path,body,expected=200,authenticated=true,retried=false){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie:authenticated?cookie:'',origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(180000)});const data=await r.json();if(expected===200&&r.status>=500&&!retried&&["withdraw","renew_consent"].includes(body?.action)){retries++;return call(path,body,expected,authenticated,true);}if(r.status!==expected)throw new Error(`HTTP_${r.status}_${/^[A-Z_]+$/.test(data.error??'')?data.error:'UNKNOWN'}`);return data;}
let stage='setup';
try{
 await db.connect();
 const row=(await db.query("SELECT p.id,s.id AS session_id,s.upload_id FROM patients p JOIN sessions s ON s.patient_id=p.id WHERE p.first_name='Portal' AND s.finished_at IS NOT NULL AND s.drive_folder_id IS NOT NULL ORDER BY p.consent_withdrawn_at NULLS FIRST,s.created_at DESC LIMIT 1")).rows[0];assert.ok(row);
 const path='/api/patients/'+row.id;
 let detail=await call(path);
 if(detail.archivedAt)detail=await call(path,{action:'restore'});
 if(detail.clearance.status==='withdrawn')detail=await call(path,{action:'renew_consent',confirmed:true,requestId:randomUUID()});
 assert.equal(detail.clearance.status,'cleared');
 stage='share_before_withdrawal';const link=await call('/api/shares',{patientId:row.id,days:1});const token=new URL(link.url).pathname.split('/').pop();
 stage='withdrawal';detail=await call(path,{action:'withdraw'});assert.equal(detail.clearance.status,'withdrawn');assert.ok(detail.links.every(l=>l.revokedAt));
 const before=(await db.query('SELECT id,consented,form_on_file,consent_text,consent_text_version,created_at FROM consent_events WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=$1) ORDER BY id',[row.id])).rows;
 const sessionCount=detail.sessions.filter(s=>s.finished).length;
 stage='renewal_confirmation_gate';await call(path,{action:'renew_consent',confirmed:false,requestId:randomUUID()},400);
 stage='renewal_concurrent_retry';const requestId=randomUUID();const renew={action:'renew_consent',confirmed:true,requestId};const responses=await Promise.all([call(path,renew),call(path,renew)]);assert.ok(responses.every(d=>d.clearance.status==='cleared'));
 detail=await call(path,renew);assert.ok(detail.links.every(l=>l.revokedAt));
 stage='immutable_history';const after=(await db.query('SELECT id,consented,form_on_file,consent_text,consent_text_version,created_at FROM consent_events WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=$1) ORDER BY id',[row.id])).rows;assert.equal(after.length,before.length+sessionCount);for(const e of before)assert.deepEqual(after.find(a=>a.id===e.id),e);
 const events=(await db.query('SELECT c.id,s.drive_folder_id FROM consent_events c JOIN sessions s ON s.id=c.session_id WHERE c.renewal_id=$1',[requestId])).rows;assert.equal(events.length,sessionCount);
 for(const event of events){const copy=await drive.files.list({q:`'${event.drive_folder_id}' in parents and trashed=false and appProperties has { key='consentEventId' and value='${event.id}' }`,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:'files(id)'});assert.equal(copy.data.files?.length,1);}
 await call('/api/share-view',{token},404,false);
 const newLink=await call('/api/shares',{patientId:row.id,days:1});const newToken=new URL(newLink.url).pathname.split('/').pop();
 stage='archive';detail=await call(path,{action:'archive'});assert.ok(detail.archivedAt);assert.equal(detail.clearance.status,'archived');assert.ok(detail.links.every(l=>l.revokedAt));
 const active=await call('/api/library',{q:detail.displayId,archive:'active'}),archived=await call('/api/library',{q:detail.displayId,archive:'archived'});assert.ok(!active.rows.some(p=>p.id===row.id));assert.ok(archived.rows.some(p=>p.id===row.id));
 await call('/api/share-view',{token:newToken},404,false);await call('/api/shares',{patientId:row.id,days:1},409);
 stage='archived_upload_block';const batch=(await db.query('SELECT manifest FROM upload_batches WHERE id=$1',[row.upload_id])).rows[0];assert.ok(batch);const key=batch.manifest[0].key;
 await call(`/api/uploads/${row.upload_id}/status`,undefined,409);
 for(const action of ['sign','media','renew','finish'])await call(`/api/uploads/${row.upload_id}/${action}`,{key},409);
 const files=batch.manifest.map(p=>({...p,key:randomUUID()}));
 await call('/api/uploads/start',{uploadId:randomUUID(),kind:'patient',patientId:row.id,treatment:'Synthetic archive check',date:'2026-10-29',description:'Synthetic only',uploadedBy:'Automated test',consented:true,formOnFile:true,files},409);
 stage='restore';detail=await call(path,{action:'restore'});assert.equal(detail.archivedAt,null);assert.equal(detail.clearance.status,'cleared');assert.ok(detail.links.every(l=>l.revokedAt));
 const restored=await call('/api/library',{q:detail.displayId,archive:'active'});assert.ok(restored.rows.some(p=>p.id===row.id));
 stage='permissions';await call(path,{action:'archive'},401,false);
 for(const table of ['consent_events','patient_activities']){const permission=(await db.query('SELECT has_table_privilege(current_user,$1,\'SELECT\') AS read,has_table_privilege(current_user,$1,\'INSERT\') AS append,has_table_privilege(current_user,$1,\'UPDATE,DELETE,TRUNCATE\') AS mutate',[table])).rows[0];assert.deepEqual(permission,{read:true,append:true,mutate:false});}
 console.log('PASS: renewal confirmation, concurrent idempotency, immutable records, one Drive copy per renewal, old links remain revoked, archive/restore, hidden active rows, all archived upload routes blocked, and restricted audit privileges.');console.log('CLIENT_EQUIVALENT_RETRIES_'+retries);
}catch(e){console.error('LIFECYCLE_CHECK_FAILED_'+stage+(/^HTTP_[A-Z0-9_]+$/.test(e.message)?'_'+e.message:''));process.exitCode=1;}finally{await db.end();}
