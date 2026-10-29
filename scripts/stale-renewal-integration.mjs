// Isolated database fixture for a renewal interrupted by archive/restore. The
// unfinished renewal is intentionally retained in the append-only test history.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
const origin=process.env.APP_URL;
assert.equal(origin,'http://localhost:3102');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sandsmedia_upload_test');
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
const jwt=await encode({secret:process.env.AUTH_SECRET,salt:'authjs.session-token',token:{sub:'stale-renewal-test',email:'allowed@example.test',verifiedGoogle:true},maxAge:3600});
const id=randomUUID(),requestId=randomUUID();
async function action(body,status=200){const response=await fetch(`${origin}/api/patients/${id}`,{method:'POST',headers:{cookie:`authjs.session-token=${jwt}`,origin,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});const result=await response.json();if(response.status!==status)throw new Error('UNEXPECTED_STATUS_'+response.status);return result;}
let stage='setup';
try{
 await db.connect();stage='clinic_lookup';
 const clinic=(await db.query('SELECT id FROM clinics WHERE slug=$1',[process.env.CLINIC_SLUG??'dr-sands'])).rows[0];assert.ok(clinic);
 // Model the durable first phase of renewal before external copies complete.
 stage='fixture_transaction';await db.query('BEGIN');
 stage='patient_fixture';await db.query(`INSERT INTO patients(id,clinic_id,display_id,first_name,last_name,consent_withdrawn_at,lifecycle_version) VALUES ($1,$2,$3,'Lifecycle','StaleFixture',CURRENT_TIMESTAMP,1)`,[id,clinic.id,`STALE-${id.slice(0,8)}`]);
 stage='renewal_fixture';await db.query(`INSERT INTO patient_activities(id,patient_id,action,actor,operation_id,patient_version) VALUES ($1,$2,'renewal_recorded','allowed@example.test',$1,1)`,[requestId,id]);
 stage='fixture_commit';await db.query('COMMIT');
 stage='archive';const archived=await action({action:'archive'});assert.equal(archived.clearance.status,'archived');
 stage='restore';const restored=await action({action:'restore'});assert.equal(restored.clearance.status,'withdrawn');assert.equal(restored.archivedAt,null);
 stage='stale_renewal';const stale=await action({action:'renew_consent',confirmed:true,requestId},409);assert.equal(stale.error,'CONSENT_RENEWAL_STALE');
 const state=(await db.query('SELECT consent_withdrawn_at IS NOT NULL AS withdrawn,lifecycle_version,archived_at IS NULL AS active FROM patients WHERE id=$1',[id])).rows[0];assert.equal(state.withdrawn,true);assert.equal(state.lifecycle_version,3);assert.equal(state.active,true);
 const audits=(await db.query('SELECT action FROM patient_activities WHERE patient_id=$1 ORDER BY created_at',[id])).rows.map(r=>r.action);assert.deepEqual(audits,['renewal_recorded','archived','restored']);
 stage='archive_fixture';await action({action:'archive'});
 console.info('PASS: a pending consent renewal cannot overwrite a later archive/restore; withdrawal remains in force and the append-only history is preserved. Synthetic fixture remains archived.');
}catch(error){try{await db.query('ROLLBACK');}catch{}const safe=['ERR_ASSERTION','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','23502','23503','42501','42703'];const code=/^UNEXPECTED_STATUS_\d+$/.test(error.message)?'_'+error.message:safe.includes(error.code)?'_'+error.code:safe.includes(error.cause?.code)?'_'+error.cause.code:/timeout|timed out/i.test(error.message)?'_TIMEOUT':/^\d[A-Z0-9]{4}$/.test(error.code)?'_'+error.code:'';console.error('STALE_RENEWAL_INTEGRATION_FAILED_'+stage+code);process.exitCode=1;}finally{await db.end();}
