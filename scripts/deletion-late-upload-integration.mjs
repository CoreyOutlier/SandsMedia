// Real Drive race check using generated fixtures in the isolated test root only.
// Never print request bodies, signed URLs, credentials, patient or file names.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {encode} from 'next-auth/jwt';
import pg from 'pg';
import {drive as createDrive, auth as googleAuth} from 'googleapis/build/src/apis/drive/index.js';

const mode = process.argv[2] ?? 'verify';
let stage = 'isolation', db, drive, patientId, folderId, cookie, origin;
const fileIds = [];
async function api(path, body, expected = 200) {
  const response = await fetch(origin + path, {method: body === undefined ? 'GET' : 'POST', headers: {cookie, origin, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000)});
  assert.equal(response.status, expected, `HTTP_${response.status}`);
  const data = await response.json();
  if (expected !== 200) assert.match(data.error ?? '', /^[A-Z_]+$/);
  return data;
}
async function metadata(fileId) {
  try {return (await drive.files.get({fileId, supportsAllDrives: true, fields: 'id,trashed,name,size'})).data;}
  catch (error) {if (error?.code === 404) return null; throw error;}
}
async function transfer(url, bytes) {
  const response = await fetch(url, {method: 'PUT', headers: {'Content-Type': 'image/jpeg', 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}`}, body: bytes, signal: AbortSignal.timeout(90000)});
  await response.body?.cancel(); return response.status;
}
try {
  assert.ok(['verify', '--cancel-probe', '--fence-probe'].includes(mode));
  origin = process.env.APP_URL;
  assert.equal(origin, 'http://localhost:3102');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sandsmedia_upload_test');
  assert.ok((process.env.ALLOWED_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).includes('allowed@example.test'));
  const production = parseEnv(await readFile(new URL('../.env.upload-production', import.meta.url), 'utf8'));
  assert.ok(process.env.DRIVE_ROOT_FOLDER_ID); assert.notEqual(process.env.DRIVE_ROOT_FOLDER_ID, production.DRIVE_ROOT_FOLDER_ID);
  db = new pg.Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000}); await db.connect();
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name, 'sandsmedia_upload_test');
  const clinic = (await db.query('SELECT id,drive_root_folder_id FROM clinics WHERE slug=$1', [process.env.CLINIC_SLUG ?? 'dr-sands'])).rows[0];
  assert.ok(clinic); assert.equal(clinic.drive_root_folder_id, process.env.DRIVE_ROOT_FOLDER_ID);
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString());
  drive = createDrive({version: 'v3', auth: new googleAuth.GoogleAuth({credentials, scopes: ['https://www.googleapis.com/auth/drive']})});
  const root = await metadata(clinic.drive_root_folder_id); assert.ok(root && !root.trashed && /test|synthetic/i.test(root.name ?? ''));
  cookie = `authjs.session-token=${await encode({secret: process.env.AUTH_SECRET, salt: 'authjs.session-token', token: {sub: 'deletion-late-upload-test', email: 'allowed@example.test', verifiedGoogle: true}, maxAge: 3600})}`;
  const bytes = await readFile(new URL('../qa/upload-fixtures/photo-1.jpg', import.meta.url));
  // JPEG readers ignore trailing padding; the third unconfirmed test fixture
  // crosses the 256 KiB Drive resumable boundary without needing new packages.
  const padded = Buffer.concat([bytes, Buffer.alloc(1024 * 1024 - bytes.length)]);
  const buffers = mode === 'verify' ? [bytes, bytes, padded] : [bytes, bytes];
  const plans = buffers.map(buffer => ({key: randomUUID(), fingerprint: createHash('sha256').update(buffer).digest('hex'), kind: 'photo', label: 'other', mimeType: 'image/jpeg', bytes: buffer.length, width: 640, height: 480, durationS: null}));
  stage = 'create_partial_upload';
  const batch = await api('/api/uploads/start', {uploadId: randomUUID(), kind: 'patient', firstName: `Deletionlate${randomUUID().replaceAll('-', '')}`, lastName: 'Synthetic', treatment: 'Synthetic late upload verification', date: '2026-11-04', description: 'Generated race fixture only', uploadedBy: 'Automated synthetic test', consented: false, formOnFile: false, files: plans});
  patientId = batch.patient.id;
  stage = 'sign_first'; const first = await api(`/api/uploads/${batch.id}/sign`, {key: plans[0].key}); fileIds.push(first.driveId);
  folderId = (await db.query('SELECT drive_folder_id FROM patients WHERE id=$1', [patientId])).rows[0].drive_folder_id;
  stage = 'unconfirmed_completion'; assert.ok([200, 201].includes(await transfer(first.url, bytes)));
  stage = 'sign_late'; const late = await api(`/api/uploads/${batch.id}/sign`, {key: plans[1].key}); fileIds.push(late.driveId);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM media WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=$1)', [patientId])).rows[0].count, 0);
  if (mode === '--cancel-probe') {
    stage = 'cancel_probe';
    assert.equal(new URL(late.url).origin, 'https://www.googleapis.com');
    const cancelled = await fetch(late.url, {method: 'DELETE', signal: AbortSignal.timeout(60000)});
    await cancelled.body?.cancel();
    const probed = await fetch(late.url, {method: 'PUT', headers: {'Content-Range': `bytes */${bytes.length}`}, body: Buffer.alloc(0), signal: AbortSignal.timeout(60000)});
    await probed.body?.cancel();
    const finalized = await transfer(late.url, bytes);
    const found = await metadata(late.driveId);
    console.info(`DELETION_CANCEL_PROBE_DELETE_${cancelled.status}_STATUS_${probed.status}_FINAL_${finalized}_FILE_${found ? 'CREATED' : 'ABSENT'}`);
  } else if (mode === '--fence-probe') {
    stage = 'reserved_id_fence_probe';
    const batchRow = (await db.query('SELECT photos_folder_id FROM upload_batches WHERE id=$1', [batch.id])).rows[0];
    assert.ok(batchRow.photos_folder_id);
    const created = await drive.files.create({supportsAllDrives: true, requestBody: {id: late.driveId, name: 'other-02.jpg', mimeType: 'image/jpeg', parents: [batchRow.photos_folder_id], appProperties: {postingCenterKey: `file:${batch.id}:${plans[1].key}`}}, fields: 'id,size,trashed'});
    assert.equal(created.data.id, late.driveId);
    await drive.files.update({fileId: late.driveId, supportsAllDrives: true, requestBody: {trashed: true}, fields: 'id'});
    const finalized = await transfer(late.url, bytes);
    const found = await metadata(late.driveId);
    console.info(`DELETION_FENCE_PROBE_CREATE_${created.status}_FINAL_${finalized}_TRASHED_${found?.trashed === true}_ZERO_BYTES_${Number(found?.size) === 0}`);
  } else {
  stage = 'partial_original_session';
  const partial = await api(`/api/uploads/${batch.id}/sign`, {key: plans[2].key}); fileIds.push(partial.driveId);
  const cut = 256 * 1024;
  const partialTransfer = await fetch(partial.url, {method: 'PUT', headers: {'Content-Type': 'image/jpeg', 'Content-Range': `bytes 0-${cut - 1}/${padded.length}`}, body: padded.subarray(0, cut), signal: AbortSignal.timeout(90000)});
  assert.equal(partialTransfer.status, 308); await partialTransfer.body?.cancel();
  stage = 'renew_partial_session';
  await api(`/api/uploads/${batch.id}/renew`, {key: plans[2].key});
  const renewed = await api(`/api/uploads/${batch.id}/sign`, {key: plans[2].key});
  assert.equal(renewed.driveId, partial.driveId); assert.notEqual(renewed.url, partial.url);
  stage = 'delete_with_open_session'; assert.deepEqual(await api(`/api/patients/${patientId}/delete`, {confirmed: true}), {deleted: true});
  assert.equal((await metadata(folderId))?.trashed, true);
  assert.equal((await metadata(first.driveId))?.trashed, true);
  stage = 'late_finalization'; const finalStatus = await transfer(late.url, bytes);
  assert.ok([400, 403, 404, 409, 410, 499].includes(finalStatus), `HTTP_${finalStatus}`);
  stage = 'late_original_partial_finalization';
  const oldFinal = await fetch(partial.url, {method: 'PUT', headers: {'Content-Type': 'image/jpeg', 'Content-Range': `bytes ${cut}-${padded.length - 1}/${padded.length}`}, body: padded.subarray(cut), signal: AbortSignal.timeout(90000)});
  assert.ok([400, 403, 404, 409, 410, 499].includes(oldFinal.status), `HTTP_${oldFinal.status}`); await oldFinal.body?.cancel();
  stage = 'late_renewed_finalization';
  const renewedStatus = await transfer(renewed.url, padded);
  assert.ok([400, 403, 404, 409, 410, 499].includes(renewedStatus), `HTTP_${renewedStatus}`);
  stage = 'reserved_placeholders_stay_trashed';
  for (const fileId of [late.driveId, partial.driveId]) {
    const placeholder = await metadata(fileId);
    assert.ok(placeholder); assert.equal(placeholder.trashed, true); assert.equal(Number(placeholder.size), 0);
  }
  stage = 'portal_remains_closed';
  await api(`/api/uploads/${batch.id}/status`, undefined, 404);
  await api(`/api/uploads/${batch.id}/media`, {key: plans[1].key}, 404);
  await api(`/api/uploads/${batch.id}/finish`, {}, 404);
  await api(`/api/patients/${patientId}`, undefined, 404);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM media WHERE session_id IN (SELECT id FROM sessions WHERE patient_id=$1)', [patientId])).rows[0].count, 0);
  console.info('DELETION_LATE_UPLOAD_PASS_UNCONFIRMED_FILE_TRASHED_EMPTY_ORIGINAL_PARTIAL_OLD_AND_RENEWED_SESSIONS_BLOCKED_RESERVED_IDS_TRASHED_PORTAL_REMAINS_CLOSED');
  }
} catch (error) {
  const safe = /^HTTP_[0-9]+$/.test(error?.message ?? '') ? `_${error.message}` : '';
  console.error(`DELETION_LATE_UPLOAD_FAILED_${stage.toUpperCase()}${safe}`); process.exitCode = 1;
} finally {
  if (db) {
    try {
      if (patientId) await db.query('UPDATE patients SET archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP) WHERE id=$1', [patientId]);
      if (drive) for (const fileId of [...fileIds, folderId].filter(Boolean)) {
        const item = await metadata(fileId);
        if (item && !item.trashed) await drive.files.update({fileId, supportsAllDrives: true, requestBody: {trashed: true}, fields: 'id'});
      }
      if (patientId) console.info('SYNTHETIC_LATE_UPLOAD_FIXTURES_RETAINED_PRIVATELY_AND_TRASHED');
    } catch {console.error('DELETION_LATE_UPLOAD_CLEANUP_FAILED'); process.exitCode = 1;}
    await db.end().catch(() => {});
  }
}
