// Synthetic-only deletion acceptance. Creates its own fixtures beneath the test
// Drive root; never logs names, file metadata, API bodies, tokens or raw errors.
import assert from 'node:assert/strict';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
import {drive as createDrive, auth as googleAuth} from 'googleapis/build/src/apis/drive/index.js';

let stage = 'isolation', db, drive, origin, ownerCookie, passcodeCookie, deniedCookie;
let preserveUiFixtures = false;
const mode = process.argv[2] ?? 'verify';
let patient, general, foreignPatient, foreignMedia, foreignGeneral, foreignGeneralMedia;
const runKey = randomUUID().replaceAll('-', '');
const search = `Deletion${runKey}`;
const fixtureFolders = new Set();
const createdPatients = new Set();
const createdGeneral = new Set();
const expectStatus = (actual, expected) => assert.ok((Array.isArray(expected) ? expected : [expected]).includes(actual), `HTTP_${actual}`);

async function response(path, body, {expected = 200, cookie = ownerCookie, requestOrigin = origin, method, headers = {}} = {}) {
  const result = await fetch(origin + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {cookie, origin: requestOrigin, 'Content-Type': 'application/json', ...headers},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  expectStatus(result.status, expected);
  assert.match(result.headers.get('cache-control') ?? '', /private/);
  assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  return result;
}
async function api(path, body, options) {return (await response(path, body, options)).json();}
async function denied(path, body, options = {}) {
  const result = await api(path, body, {...options, expected: options.expected ?? 404});
  assert.equal(typeof result.error, 'string');
  assert.match(result.error, /^[A-Z_]+$/);
  assert.ok(!JSON.stringify(result).includes(search));
  return result;
}
async function driveMeta(id) {
  try {return (await drive.files.get({fileId: id, supportsAllDrives: true, fields: 'id,trashed,parents,mimeType,name'})).data;}
  catch (error) {if (error?.code === 404) return null; throw error;}
}
async function trashState(id, expected) {
  const result = await driveMeta(id);
  assert.ok(result);
  assert.equal(result.trashed, expected);
}
function plans(buffers, kinds) {
  return buffers.map((bytes, index) => ({
    key: randomUUID(), fingerprint: createHash('sha256').update(bytes).digest('hex'),
    kind: kinds[index], label: kinds[index] === 'video' ? 'testimonial' : index === 0 ? 'before' : 'after',
    mimeType: kinds[index] === 'video' ? 'video/mp4' : 'image/jpeg', bytes: bytes.length,
    width: 640, height: 480, durationS: kinds[index] === 'video' ? 2 : null,
    title: kinds[index] === 'video' ? 'Synthetic deletion video' : null,
  }));
}
async function upload(kind, buffers, kinds) {
  stage = `fixture_${kind}_start`;
  const files = plans(buffers, kinds);
  const input = {
    uploadId: randomUUID(), kind, firstName: search, lastName: 'Synthetic',
    title: search, treatment: 'Synthetic deletion verification', date: '2026-11-04',
    description: 'Generated test fixtures only', uploadedBy: 'Automated synthetic test',
    consented: kind === 'patient', formOnFile: kind === 'patient', files,
  };
  const batch = await api('/api/uploads/start', input);
  if (batch.patient) createdPatients.add(batch.patient.id);
  for (let index = 0; index < files.length; index++) {
    stage = `fixture_${kind}_${index}_sign`;
    const signed = await api(`/api/uploads/${batch.id}/sign`, {key: files[index].key});
    const createdFolder = (await db.query(kind === 'patient'
      ? 'SELECT p.drive_folder_id FROM patients p JOIN sessions s ON s.patient_id=p.id WHERE s.upload_id=$1'
      : 'SELECT drive_folder_id FROM general_uploads WHERE upload_id=$1', [batch.id])).rows[0]?.drive_folder_id;
    if (createdFolder) fixtureFolders.add(createdFolder);
    stage = `fixture_${kind}_${index}_transfer`;
    const sent = await fetch(signed.url, {
      method: 'PUT', headers: {'Content-Type': files[index].mimeType, 'Content-Range': `bytes 0-${files[index].bytes - 1}/${files[index].bytes}`},
      body: buffers[index], signal: AbortSignal.timeout(90000),
    });
    expectStatus(sent.status, [200, 201]); await sent.body?.cancel();
    stage = `fixture_${kind}_${index}_confirm`;
    await api(`/api/uploads/${batch.id}/media`, {key: files[index].key});
  }
  stage = `fixture_${kind}_finish`;
  await api(`/api/uploads/${batch.id}/finish`, {});
  const sql = kind === 'patient'
    ? 'SELECT s.id,s.patient_id,s.drive_folder_id,p.drive_folder_id AS patient_folder_id FROM sessions s JOIN patients p ON p.id=s.patient_id WHERE s.upload_id=$1'
    : 'SELECT id,drive_folder_id FROM general_uploads WHERE upload_id=$1';
  const row = (await db.query(sql, [batch.id])).rows[0]; assert.ok(row);
  if (kind === 'general') createdGeneral.add(row.id);
  const folderId = row.patient_folder_id ?? row.drive_folder_id;
  fixtureFolders.add(folderId);
  const detail = await api(kind === 'patient' ? `/api/patients/${row.patient_id}` : `/api/general/${row.id}`);
  return {kind, batch, input, row, detail, files};
}
async function retainedConsent(patientId) {
  return (await db.query('SELECT c.* FROM consent_events c JOIN sessions s ON s.id=c.session_id WHERE s.patient_id=$1 ORDER BY c.id', [patientId])).rows;
}
async function retainedActivities(patientId) {
  return (await db.query('SELECT * FROM patient_activities WHERE patient_id=$1 ORDER BY id', [patientId])).rows;
}
async function mediaRow(id, generalFlag = false) {
  return (await db.query(`SELECT id,drive_file_id,file_name,deleted_at,drive_trashed_at FROM ${generalFlag ? 'general_media' : 'media'} WHERE id=$1`, [id])).rows[0];
}
async function allRows(patientId) {
  const queries = [
    'SELECT count(*)::int AS count FROM patients WHERE id=$1',
    'SELECT count(*)::int AS count FROM sessions WHERE patient_id=$1',
    'SELECT count(*)::int AS count FROM media WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=$1)',
    'SELECT count(*)::int AS count FROM consent_events WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=$1)',
  ];
  const result = [];
  for (const sql of queries) result.push((await db.query(sql, [patientId])).rows[0].count);
  return result;
}
async function createForeignFixtures() {
  const clinicId = randomUUID(); foreignPatient = randomUUID(); foreignMedia = randomUUID();
  foreignGeneral = randomUUID(); foreignGeneralMedia = randomUUID(); const sessionId = randomUUID();
  await db.query("INSERT INTO clinics(id,name,slug,upload_passcode_hash,drive_root_folder_id) VALUES($1,'Synthetic deletion isolation',$2,'disabled-test-only',$3)", [clinicId, `synthetic-deletion-${runKey}`, `synthetic-root-${runKey}`]);
  await db.query("INSERT INTO patients(id,clinic_id,display_id,first_name,last_name,drive_folder_id) VALUES($1,$2,$3,$4,'Foreign',$5)", [foreignPatient, clinicId, `DELETE-${runKey}`, search, `synthetic-patient-${runKey}`]);
  createdPatients.add(foreignPatient);
  await db.query("INSERT INTO sessions(id,patient_id,upload_id,date,treatment,uploaded_by,drive_folder_id,finished_at) VALUES($1,$2,$3,'2026-11-04','Synthetic isolation','Automated synthetic test',$4,CURRENT_TIMESTAMP)", [sessionId, foreignPatient, randomUUID(), `synthetic-session-${runKey}`]);
  await db.query("INSERT INTO media(id,session_id,kind,label,drive_file_id,file_name,position,bytes) VALUES($1,$2,'photo','other',$3,'other-01.jpg',0,1024)", [foreignMedia, sessionId, `synthetic-file-${runKey}`]);
  await db.query("INSERT INTO general_uploads(id,clinic_id,upload_id,title,uploaded_by,date,drive_folder_id,finished_at) VALUES($1,$2,$3,$4,'Automated synthetic test','2026-11-04',$5,CURRENT_TIMESTAMP)", [foreignGeneral, clinicId, randomUUID(), search, `synthetic-general-${runKey}`]);
  await db.query("INSERT INTO general_media(id,general_upload_id,kind,drive_file_id,file_name,position,bytes) VALUES($1,$2,'photo',$3,'other-01.jpg',0,1024)", [foreignGeneralMedia, foreignGeneral, `synthetic-general-file-${runKey}`]);
}
async function zipBytes(path, options) {return Buffer.from(await (await response(path, undefined, options)).arrayBuffer());}

try {
  assert.ok(['verify', '--prepare-ui'].includes(mode));
  origin = process.env.APP_URL;
  assert.equal(origin, 'http://localhost:3102');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sandsmedia_upload_test');
  assert.ok((process.env.ALLOWED_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).includes('allowed@example.test'));
  // A copied database must never make this test upload into production storage.
  const production = parseEnv(await readFile(new URL('../.env.upload-production', import.meta.url), 'utf8'));
  assert.ok(process.env.DRIVE_ROOT_FOLDER_ID);
  assert.notEqual(process.env.DRIVE_ROOT_FOLDER_ID, production.DRIVE_ROOT_FOLDER_ID);
  db = new pg.Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000});
  await db.connect();
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'sandsmedia_upload_test');
  const clinic = (await db.query('SELECT id,upload_passcode_hash,drive_root_folder_id FROM clinics WHERE slug=$1', [process.env.CLINIC_SLUG ?? 'dr-sands'])).rows[0];
  assert.ok(clinic); assert.equal(clinic.drive_root_folder_id, process.env.DRIVE_ROOT_FOLDER_ID);
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString());
  drive = createDrive({version: 'v3', auth: new googleAuth.GoogleAuth({credentials, scopes: ['https://www.googleapis.com/auth/drive']})});
  const root = await driveMeta(clinic.drive_root_folder_id);
  assert.ok(root && !root.trashed && /test|synthetic/i.test(root.name ?? ''));
  const cookieFor = async email => `authjs.session-token=${await encode({secret: process.env.AUTH_SECRET, salt: 'authjs.session-token', token: {sub: 'deletion-test', email, verifiedGoogle: true}, maxAge: 3600})}`;
  ownerCookie = await cookieFor('allowed@example.test'); deniedCookie = await cookieFor('not-allowed@example.test');
  const sign = value => createHmac('sha256', process.env.COOKIE_SECRET ?? process.env.AUTH_SECRET).update(value).digest('hex');
  const payload = Buffer.from(JSON.stringify({clinicId: clinic.id, passcodeVersion: sign(clinic.upload_passcode_hash), expires: Date.now() + 3600000, id: randomUUID()})).toString('base64url');
  passcodeCookie = `posting-center-upload=${payload}.${sign(payload)}`;

  stage = 'fixtures';
  const buffers = await Promise.all(['photo-1.jpg', 'photo-2.jpg', 'synthetic-video.mp4'].map(name => readFile(new URL(`../qa/upload-fixtures/${name}`, import.meta.url))));
  patient = await upload('patient', buffers, ['photo', 'photo', 'video']);
  general = await upload('general', [buffers[0], buffers[2]], ['photo', 'video']);
  if (mode === '--prepare-ui') {
    await writeFile(new URL('../qa/deletion-ui-fixtures.json', import.meta.url), JSON.stringify({
      patientId: patient.row.patient_id, patientPath: `/patients?patient=${patient.row.patient_id}`,
      generalId: general.row.id, generalPath: '/other-uploads', search,
    }), {mode: 0o600});
    preserveUiFixtures = true;
    console.info('SYNTHETIC_DELETION_UI_FIXTURES_READY');
  } else {
  await createForeignFixtures();
  const patientId = patient.row.patient_id;
  const photo = patient.detail.sessions[0].media.find(item => item.kind === 'photo');
  const keptPhoto = patient.detail.sessions[0].media.find(item => item.kind === 'photo' && item.id !== photo.id);
  const video = patient.detail.sessions[0].media.find(item => item.kind === 'video');
  const generalPhoto = general.detail.sessions[0].media.find(item => item.kind === 'photo');
  const generalVideo = general.detail.sessions[0].media.find(item => item.kind === 'video');
  const photoBefore = await mediaRow(photo.id), generalBefore = await mediaRow(generalPhoto.id, true);
  const keptBefore = await mediaRow(keptPhoto.id), generalVideoBefore = await mediaRow(generalVideo.id, true);
  const consentBefore = await retainedConsent(patientId); assert.ok(consentBefore.length);
  const activitiesBefore = await retainedActivities(patientId);
  const countsBefore = await allRows(patientId);
  const link = await api('/api/shares', {patientId, days: 1});
  const token = new URL(link.url).pathname.split('/').pop();
  const sharedBefore = await api('/api/share-view', {token, refresh: true}, {cookie: ''});
  const sharedPhoto = sharedBefore.sessions.flatMap(session => session.media).find(item => item.id === photo.id);
  const sharedVideo = sharedBefore.sessions.flatMap(session => session.media).find(item => item.id === video.id);
  assert.ok(sharedPhoto && sharedVideo);

  console.info('SYNTHETIC_DELETION_UPLOAD_FIXTURES_COMPLETE');
  stage = 'permission_origin_scope_confirmation';
  const targets = [
    [`/api/patients/${patientId}/delete`, {confirmed: true}],
    [`/api/media/${photo.id}/delete`, {general: false, confirmed: true}],
    [`/api/media/${generalPhoto.id}/delete`, {general: true, confirmed: true}],
  ];
  for (const [path, body] of targets) {
    for (const cookie of ['', passcodeCookie, deniedCookie]) await denied(path, body, {cookie, expected: 401});
    await denied(path, body, {requestOrigin: 'https://untrusted.example.test', expected: 403});
    for (const confirmed of [undefined, false, null, 'true', 1]) await denied(path, {...body, confirmed}, {expected: 400});
  }
  for (const invalidGeneral of [undefined, null, 'false', 0]) await denied(`/api/media/${photo.id}/delete`, {general: invalidGeneral, confirmed: true}, {expected: 400});
  for (const id of [foreignPatient, randomUUID()]) await denied(`/api/patients/${id}/delete`, {confirmed: true});
  for (const [id, generalFlag] of [[foreignMedia, false], [foreignGeneralMedia, true], [randomUUID(), false], [photo.id, true], [generalPhoto.id, false]]) await denied(`/api/media/${id}/delete`, {general: generalFlag, confirmed: true});
  assert.equal((await mediaRow(photo.id)).deleted_at, null);
  assert.equal((await mediaRow(generalPhoto.id, true)).deleted_at, null);
  assert.equal((await db.query('SELECT deleted_at FROM patients WHERE id=$1', [foreignPatient])).rows[0].deleted_at, null);
  assert.equal((await mediaRow(foreignMedia)).deleted_at, null);
  assert.equal((await mediaRow(foreignGeneralMedia, true)).deleted_at, null);

  console.info('DELETION_AUTH_SCOPE_AND_CONFIRMATION_CHECKS_PASSED');
  stage = 'photo_delete_concurrent_retry';
  const photoDelete = {general: false, confirmed: true};
  await Promise.all([api(`/api/media/${photo.id}/delete`, photoDelete), api(`/api/media/${photo.id}/delete`, photoDelete)]);
  const photoAfter = await mediaRow(photo.id);
  assert.ok(photoAfter.deleted_at); assert.ok(photoAfter.drive_trashed_at);
  await api(`/api/media/${photo.id}/delete`, photoDelete);
  assert.deepEqual(await mediaRow(photo.id), photoAfter);
  await trashState(photoBefore.drive_file_id, true);
  for (const path of [photo.thumbnail, photo.stream, photo.download]) await denied(path);
  for (const path of [sharedPhoto.thumbnail, sharedPhoto.stream, sharedPhoto.download]) await denied(path, undefined, {cookie: ''});
  let detail = await api(`/api/patients/${patientId}`);
  assert.equal(detail.sessions.flatMap(session => session.media).length, 2);
  assert.ok(!detail.sessions.flatMap(session => session.media).some(item => item.id === photo.id));
  let shared = await api('/api/share-view', {token, refresh: true}, {cookie: ''});
  assert.equal(shared.sessions.flatMap(session => session.media).length, 2);
  const row = (await api('/api/library', {q: patient.detail.displayId})).rows.find(item => item.id === patientId);
  assert.equal(row.photos, 1); assert.equal(row.videos, 1);
  assert.deepEqual(await retainedConsent(patientId), consentBefore);
  assert.deepEqual(await allRows(patientId), countsBefore);
  let zip = await zipBytes(detail.download); assert.ok(!zip.includes(Buffer.from(photoBefore.file_name))); assert.ok(zip.includes(Buffer.from(keptBefore.file_name)));
  zip = await zipBytes(shared.download, {cookie: ''}); assert.ok(!zip.includes(Buffer.from(photoBefore.file_name))); assert.ok(zip.includes(Buffer.from(keptBefore.file_name)));

  stage = 'restored_drive_object_stays_deleted';
  // Simulate a storage administrator restoring only this generated fixture.
  // Portal tombstones must remain authoritative, including private ZIP exports.
  await drive.files.update({fileId: photoBefore.drive_file_id, supportsAllDrives: true, requestBody: {trashed: false}, fields: 'id'});
  await trashState(photoBefore.drive_file_id, false);
  await denied(photo.download);
  zip = await zipBytes(detail.download); assert.ok(!zip.includes(Buffer.from(photoBefore.file_name)));
  await denied(`/api/uploads/${patient.batch.id}/media`, {key: patient.files[0].key}, {expected: 404});
  await denied(`/api/uploads/${patient.batch.id}/renew`, {key: patient.files[0].key}, {expected: 404});
  const recon = await api('/api/admin', {action: 'reconcile'});
  assert.equal(typeof recon.checked, 'number');
  assert.equal((await mediaRow(photo.id)).deleted_at.toISOString(), photoAfter.deleted_at.toISOString());
  assert.ok(!(await api(`/api/patients/${patientId}`)).sessions.flatMap(session => session.media).some(item => item.id === photo.id));
  assert.ok(!(await api('/api/share-view', {token, refresh: true}, {cookie: ''})).sessions.flatMap(session => session.media).some(item => item.id === photo.id));
  await drive.files.update({fileId: photoBefore.drive_file_id, supportsAllDrives: true, requestBody: {trashed: true}, fields: 'id'});

  stage = 'general_media_pending_cleanup';
  // Simulate a recoverable storage ownership mismatch on our own new fixture.
  // The portal must hide first, preserve the object, and retry after correction.
  await drive.files.update({fileId: generalBefore.drive_file_id, supportsAllDrives: true, requestBody: {appProperties: {postingCenterKey: `synthetic-deletion-blocked:${runKey}`}}, fields: 'id'});
  const pending = await denied(`/api/media/${generalPhoto.id}/delete`, {general: true, confirmed: true}, {expected: 503});
  assert.equal(pending.error, 'DELETION_PENDING');
  const pendingRow = await mediaRow(generalPhoto.id, true);
  assert.ok(pendingRow.deleted_at); assert.equal(pendingRow.drive_trashed_at, null);
  await trashState(generalBefore.drive_file_id, false);
  await denied(generalPhoto.download);
  assert.ok(!(await api(`/api/general/${general.row.id}`)).sessions.flatMap(session => session.media).some(item => item.id === generalPhoto.id));
  zip = await zipBytes(general.detail.download); assert.ok(!zip.includes(Buffer.from(generalBefore.file_name)));
  await drive.files.update({fileId: generalBefore.drive_file_id, supportsAllDrives: true, requestBody: {appProperties: {postingCenterKey: `file:${general.batch.id}:${general.files[0].key}`}}, fields: 'id'});
  const cleanup = await api('/api/admin', {action: 'reconcile'});
  assert.ok(cleanup.deletionCleanupCompleted >= 1);
  assert.ok((await mediaRow(generalPhoto.id, true)).drive_trashed_at);
  await api(`/api/media/${generalPhoto.id}/delete`, {general: true, confirmed: true});
  const generalAfter = await mediaRow(generalPhoto.id, true);
  assert.ok(generalAfter.deleted_at && generalAfter.drive_trashed_at);
  await trashState(generalBefore.drive_file_id, true);
  for (const path of [generalPhoto.thumbnail, generalPhoto.stream, generalPhoto.download]) await denied(path);
  const generalDetail = await api(`/api/general/${general.row.id}`);
  assert.deepEqual(generalDetail.sessions.flatMap(session => session.media).map(item => item.id), [generalVideo.id]);
  const generalRow = (await api('/api/library', {general: true, q: search})).rows.find(item => item.id === general.row.id);
  assert.equal(generalRow.photos, 0); assert.equal(generalRow.videos, 1);
  zip = await zipBytes(generalDetail.download); assert.ok(!zip.includes(Buffer.from(generalBefore.file_name))); assert.ok(zip.includes(Buffer.from(generalVideoBefore.file_name)));

  stage = 'general_video_delete';
  await api(`/api/media/${generalVideo.id}/delete`, {general: true, confirmed: true});
  const generalVideoAfter = await mediaRow(generalVideo.id, true);
  assert.ok(generalVideoAfter.deleted_at && generalVideoAfter.drive_trashed_at);
  await trashState(generalVideoBefore.drive_file_id, true);
  await denied(generalVideo.download);
  await denied(`/api/media/${generalVideo.id}/title`, {general: true, title: 'Synthetic rename rejected'});
  assert.equal((await api(`/api/general/${general.row.id}`)).sessions.flatMap(session => session.media).length, 0);
  for (const media of ['photo', 'video']) assert.ok(!(await api('/api/library', {general: true, q: search, media})).rows.some(item => item.id === general.row.id));

  console.info('DELETION_MEDIA_STORAGE_RETRY_AND_RECONCILIATION_CHECKS_PASSED');
  stage = 'patient_delete_concurrent_retry';
  const beforeDeletion = await retainedActivities(patientId);
  const racingInput = {...patient.input, uploadId: randomUUID(), patientId, files: plans([buffers[0]], ['photo'])};
  const racingStart = response('/api/uploads/start', racingInput, {expected: [200, 404]}).then(value => ({value}), error => ({error}));
  await Promise.all([api(`/api/patients/${patientId}/delete`, {confirmed: true}), api(`/api/patients/${patientId}/delete`, {confirmed: true})]);
  const raceResult = await racingStart;
  if (raceResult.error) throw raceResult.error;
  const raced = raceResult.value; const racedBody = await raced.json();
  if (raced.status === 200) await denied(`/api/uploads/${racedBody.id}/status`);
  else assert.equal(racedBody.error, 'PATIENT_NOT_FOUND');
  const deletedPatient = (await db.query('SELECT deleted_at,drive_trashed_at,lifecycle_version FROM patients WHERE id=$1', [patientId])).rows[0];
  assert.ok(deletedPatient.deleted_at && deletedPatient.drive_trashed_at);
  await api(`/api/patients/${patientId}/delete`, {confirmed: true});
  assert.deepEqual((await db.query('SELECT deleted_at,drive_trashed_at,lifecycle_version FROM patients WHERE id=$1', [patientId])).rows[0], deletedPatient);
  await trashState(patient.row.patient_folder_id, true);
  for (const archive of ['active', 'archived', 'all']) for (const collection of ['all', 'favorites', 'celebrities']) {
    assert.ok(!(await api('/api/library', {q: patient.detail.displayId, archive, collection})).rows.some(item => item.id === patientId));
  }
  assert.ok(!(await api('/api/patients/search', {q: patient.detail.displayId})).patients.some(item => item.id === patientId));
  await denied(`/api/patients/${patientId}`);
  await denied(`/api/download/patient/${patientId}`);
  for (const item of [keptPhoto, video]) for (const path of [item.thumbnail, item.stream, item.download]) await denied(path);
  for (const action of ['restore', 'archive', 'favorite', 'celebrity', 'renew_consent']) await denied(`/api/patients/${patientId}`, {action, value: true, confirmed: true, requestId: randomUUID()});
  await denied(`/api/media/${video.id}/title`, {general: false, title: 'Synthetic rename rejected'});
  await denied('/api/shares', {patientId, days: 1}, {expected: 404});
  await denied('/api/share-view', {token, refresh: true}, {cookie: ''});
  for (const path of [sharedVideo.thumbnail, sharedVideo.stream, sharedVideo.download, sharedBefore.download]) await denied(path, undefined, {cookie: '', expected: [403, 404]});
  await denied(`/api/uploads/${patient.batch.id}/status`, undefined, {expected: 404});
  for (const action of ['sign', 'media', 'renew', 'finish']) await denied(`/api/uploads/${patient.batch.id}/${action}`, {key: patient.files[1].key}, {expected: 404});
  await denied('/api/uploads/start', {...patient.input, uploadId: randomUUID(), patientId, files: plans([buffers[0]], ['photo'])}, {expected: 404});
  assert.deepEqual(await retainedConsent(patientId), consentBefore);
  const countsAfter = await allRows(patientId);
  assert.deepEqual(countsAfter, [countsBefore[0], countsBefore[1] + (raced.status === 200 ? 1 : 0), countsBefore[2], countsBefore[3]]);
  const afterActivities = await retainedActivities(patientId);
  for (const activity of [...activitiesBefore, ...beforeDeletion]) assert.deepEqual(afterActivities.find(item => item.id === activity.id), activity);
  assert.equal(afterActivities.length, beforeDeletion.length + 1);
  assert.equal(afterActivities.filter(item => item.action === 'deleted').length, 1);
  const revoked = (await db.query('SELECT revoked_at FROM share_links WHERE patient_id=$1', [patientId])).rows;
  assert.ok(revoked.length && revoked.every(item => item.revoked_at));

  stage = 'audit_permissions';
  for (const table of ['consent_events', 'patient_activities']) {
    const privileges = (await db.query("SELECT has_table_privilege(current_user,$1,'SELECT') AS read,has_table_privilege(current_user,$1,'INSERT') AS append,has_table_privilege(current_user,$1,'UPDATE,DELETE,TRUNCATE') AS mutate", [table])).rows[0];
    assert.deepEqual(privileges, {read: true, append: true, mutate: false});
  }
  console.info('DELETION_INTEGRATION_PASS_AUTH_ORIGIN_CLINIC_SCOPE_CONFIRMATION_CONCURRENT_RETRIES_PHOTOS_GENERAL_VIDEO_COUNTS_DRIVE_TRASH_PENDING_RETRY_PRIVATE_PUBLIC_URLS_ZIP_TOMBSTONES_RESUME_RECONCILE_AUDIT_RETAINED');
  }
} catch (error) {
  const safeCode = /^HTTP_[0-9]+$/.test(error?.message ?? '') ? `_${error.message}` : /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? `_DATABASE_${error.code}` : '';
  console.error(`DELETION_INTEGRATION_FAILED_${stage.toUpperCase()}${safeCode}`);
  process.exitCode = 1;
} finally {
  // Only identifiers created in this execution are used in cleanup. Immutable
  // history remains intact; generated Drive fixture folders are recoverable trash.
  if (db) {
    try {
      if (!preserveUiFixtures) {
      if (createdPatients.size) await db.query('UPDATE patients SET archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP) WHERE id=ANY($1::uuid[])', [[...createdPatients]]);
      if (drive) for (const fileId of fixtureFolders) await drive.files.update({fileId, supportsAllDrives: true, requestBody: {trashed: true}, fields: 'id'});
      if (createdPatients.size || createdGeneral.size) console.info('SYNTHETIC_DELETION_FIXTURES_RETAINED_PRIVATELY_AND_DRIVE_FOLDERS_TRASHED');
      }
    } catch {console.error('DELETION_FIXTURE_CLEANUP_FAILED'); process.exitCode = 1;}
    await db.end().catch(() => {});
  }
}
