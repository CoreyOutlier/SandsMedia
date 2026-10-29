// Additive migration runner. Credentials, row contents and raw database errors
// are never printed. Run with the intended owner environment explicitly loaded.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';

const run=promisify(execFile);
const migration='202610290004_patient_collections';
const target=process.argv[2];
let db,stage='target';
const tables=['patients','sessions','media','general_uploads','general_media','consent_events','patient_activities','share_links'];
async function counts(){
 const result={};
 for(const table of tables)result[table]=BigInt((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
 return result;
}
async function auditGuards(){
 for(const table of ['consent_events','patient_activities']){
  const triggers=(await db.query('SELECT tgenabled FROM pg_trigger WHERE tgrelid=$1::regclass AND NOT tgisinternal',[`public.${table}`])).rows;
  assert.equal(triggers.length,2);assert.ok(triggers.every(t=>t.tgenabled==='A'));
  const permissions=(await db.query("SELECT has_table_privilege('posting_center_app',$1,'SELECT') AS read,has_table_privilege('posting_center_app',$1,'INSERT') AS append,has_table_privilege('posting_center_app',$1,'UPDATE,DELETE,TRUNCATE') AS mutate",[table])).rows[0];
  assert.deepEqual(permissions,{read:true,append:true,mutate:false});
 }
}
try{
 assert.ok(['test','production'].includes(target));
 const connection=new URL(process.env.DATABASE_URL);
 assert.equal(connection.pathname==='/sandsmedia_upload_test',target==='test');
 if(target==='production')assert.ok(process.env.DRIVE_ROOT_FOLDER_ID);
 connection.searchParams.set('sslmode','verify-full');
 db=new pg.Client({connectionString:connection.toString(),connectionTimeoutMillis:20000});await db.connect();
 stage='database_identity';
 const identity=(await db.query('SELECT current_database() AS database,current_user AS role')).rows[0];
 assert.equal(identity.database,decodeURIComponent(connection.pathname.slice(1)));
 assert.notEqual(identity.role,'posting_center_app');
 if(target==='test')assert.equal(identity.database,'sandsmedia_upload_test');
 else{
  const clinic=(await db.query('SELECT drive_root_folder_id FROM clinics WHERE slug=$1',[process.env.CLINIC_SLUG??'dr-sands'])).rows;
  assert.equal(clinic.length,1);assert.equal(clinic[0].drive_root_folder_id,process.env.DRIVE_ROOT_FOLDER_ID);
 }
 const migrations=(await db.query('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations')).rows;
 assert.ok(migrations.some(m=>m.migration_name==='202610290003_patient_lifecycle_titles'&&m.finished_at));
 assert.ok(migrations.every(m=>m.finished_at||m.rolled_back_at));
 await auditGuards();
 const before=await counts();
 stage='migration';
 const migrationConnection=new URL(connection);
 migrationConnection.searchParams.set('sslmode','require');
 migrationConnection.searchParams.set('sslaccept','strict');
 await run(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','prisma7.config.ts'],{
  cwd:process.cwd(),env:{...process.env,DATABASE_URL:migrationConnection.toString()},timeout:120000,maxBuffer:2*1024*1024,
 });
 stage='verification';
 const applied=(await db.query('SELECT finished_at FROM _prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL',[migration])).rows;
 assert.equal(applied.length,1);assert.ok(applied[0].finished_at);
 const after=await counts();for(const table of tables)assert.ok(after[table]>=before[table]);
 const columns=(await db.query("SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='patients' AND column_name IN ('is_favorite','is_celebrity')")).rows;
 assert.equal(columns.length,2);assert.ok(columns.every(c=>c.is_nullable==='NO'&&c.column_default==='false'));
 for(const column of ['is_favorite','is_celebrity']){
  const permissions=(await db.query("SELECT has_column_privilege('posting_center_app','patients',$1,'SELECT') AS read,has_column_privilege('posting_center_app','patients',$1,'UPDATE') AS write",[column])).rows[0];
  assert.deepEqual(permissions,{read:true,write:true});
 }
 await auditGuards();
 console.info(`PASS: ${target} patient collection migration applied; existing record counts preserved, defaults verified, runtime flag access valid, consent/history remain append-only.`);
}catch{
 console.error(`PATIENT_COLLECTION_MIGRATION_FAILED_${stage}`);process.exitCode=1;
}finally{await db?.end().catch(()=>{});}
