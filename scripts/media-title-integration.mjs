import assert from 'node:assert/strict';
import { encode } from 'next-auth/jwt';
import pg from 'pg';
import { drive as createDrive, auth as googleAuth } from 'googleapis/build/src/apis/drive/index.js';

// Never point this mutation test at the production application or database.
let origin, cookie, drive;
try {
  origin = process.env.APP_URL;
  assert.equal(origin, 'http://localhost:3102');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sandsmedia_upload_test');
  assert.ok((process.env.ALLOWED_EMAILS ?? '').split(',').includes('allowed@example.test'));
  const jwt = await encode({ secret: process.env.AUTH_SECRET, salt: 'authjs.session-token', token: { sub: 'media-title-test', email: 'allowed@example.test', verifiedGoogle: true }, maxAge: 3600 });
  cookie = `authjs.session-token=${jwt}`;
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString());
  drive = createDrive({ version: 'v3', auth: new googleAuth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] }) });
} catch { console.error('MEDIA_TITLE_TEST_SETUP_OR_ISOLATION_FAILED'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
let stage = 'setup';
let fixture;
let renamed = false;
async function call(id, body, expected = 200, authCookie = cookie) {
  const response = await fetch(`${origin}/api/media/${id}/title`, {
    method: 'POST', headers: { cookie: authCookie, origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(75000),
  });
  const data = await response.json();
  if (response.status !== expected) {
    const code = typeof data.error === 'string' && /^[A-Z_]+$/.test(data.error) ? data.error : 'UNKNOWN';
    throw new Error(`HTTP_${response.status}_${code}`);
  }
  return data;
}
async function verify(title, fileName) {
  const row = (await db.query('SELECT m.title,m.file_name,m.drive_file_id,b.manifest FROM general_media m JOIN general_uploads u ON u.id=m.general_upload_id JOIN upload_batches b ON b.id=u.upload_id WHERE m.id=$1', [fixture.id])).rows[0];
  assert.equal(row.title, title);
  assert.equal(row.file_name, fileName);
  assert.equal(row.drive_file_id, fixture.drive_file_id);
  const plan = row.manifest.find(file => file.driveId === fixture.drive_file_id);
  assert.ok(plan?.confirmed);
  assert.equal(plan.title ?? null, title);
  assert.equal(plan.name, fileName);
  const actual = (await drive.files.get({ fileId: fixture.drive_file_id, supportsAllDrives: true, fields: 'id,name,parents,appProperties,trashed' })).data;
  assert.equal(actual.id, fixture.drive_file_id);
  assert.equal(actual.name, fileName);
  assert.equal(actual.trashed, false);
  assert.ok(actual.parents?.includes(fixture.videos_folder_id));
  assert.equal(actual.appProperties?.postingCenterKey, `file:${fixture.upload_id}:${plan.key}`);
}

try {
  stage = 'database_connect';
  await db.connect();
  // General upload only; do not mutate patient rows used by lifecycle tests.
  stage = 'fixture_lookup';
  fixture = (await db.query("SELECT m.id,m.title,m.file_name,m.drive_file_id,u.upload_id,b.videos_folder_id FROM general_media m JOIN general_uploads u ON u.id=m.general_upload_id JOIN upload_batches b ON b.id=u.upload_id JOIN clinics c ON c.id=u.clinic_id WHERE m.kind='video' AND u.finished_at IS NOT NULL AND u.title LIKE 'Synthetic%' AND c.slug=$1 ORDER BY m.created_at LIMIT 1", [process.env.CLINIC_SLUG ?? 'dr-sands'])).rows[0];
  stage = 'fixture_required';
  assert.ok(fixture, 'SYNTHETIC_GENERAL_VIDEO_REQUIRED');
  const originalParts = /^(before|after|testimonial|other)-(\d+)(?: - .*)?\.(mp4|mov|webm|m4v)$/.exec(fixture.file_name);
  assert.ok(originalParts);
  const title = 'Café 🎬 Première prise';
  const expectedName = `${originalParts[1]}-${originalParts[2]} - ${title}.${originalParts[3]}`;
  const request = { general: true, title: ' Café 🎬 / Première\\prise\n ' };

  stage = 'unauthenticated';
  const unauthenticated = await call(fixture.id, request, 401, '');
  assert.equal(unauthenticated.error, 'SIGN_IN_REQUIRED');
  stage = 'cross_library';
  const wrongLibrary = await call(fixture.id, { ...request, general: false }, 404);
  assert.equal(wrongLibrary.error, 'MEDIA_NOT_FOUND');
  stage = 'photo_rejection';
  const photo = (await db.query("SELECT m.id FROM media m JOIN sessions s ON s.id=m.session_id JOIN patients p ON p.id=s.patient_id JOIN clinics c ON c.id=p.clinic_id WHERE m.kind='photo' AND s.finished_at IS NOT NULL AND p.archived_at IS NULL AND c.slug=$1 ORDER BY m.created_at LIMIT 1", [process.env.CLINIC_SLUG ?? 'dr-sands'])).rows[0];
  assert.ok(photo, 'SYNTHETIC_PHOTO_REQUIRED');
  const rejectedPhoto = await call(photo.id, { general: false, title: 'Should not save' }, 400);
  assert.equal(rejectedPhoto.error, 'VIDEO_REQUIRED');

  stage = 'rename';
  // Restore even if a lost response hides a successful Drive rename.
  renamed = true;
  const result = await call(fixture.id, request);
  assert.equal(result.title, title);
  assert.equal(result.fileName, expectedName);
  await verify(title, expectedName);
  stage = 'idempotent_retry';
  assert.deepEqual(await call(fixture.id, request), result);
  await verify(title, expectedName);
  stage = 'restore_original';
  await call(fixture.id, { general: true, title: fixture.title });
  await verify(fixture.title, fixture.file_name);
  renamed = false;
  console.info('MEDIA_TITLE_INTEGRATION_PASS_UNICODE_RENAME_RETRY_DRIVE_DATABASE_MANIFEST_AUTH_PHOTO_LIBRARY_SCOPE');
} catch (error) {
  const code = typeof error?.message === 'string' && /^HTTP_[0-9]+_[A-Z_]+$/.test(error.message) ? `_${error.message}` : typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? `_DATABASE_${error.code}` : '';
  console.error(`MEDIA_TITLE_INTEGRATION_FAILED_${stage.toUpperCase()}${code}`);
  process.exitCode = 1;
} finally {
  if (renamed && fixture) {
    try { await call(fixture.id, { general: true, title: fixture.title }); console.info('MEDIA_TITLE_FIXTURE_RESTORED'); }
    catch { console.error('MEDIA_TITLE_FIXTURE_RESTORE_FAILED'); process.exitCode = 1; }
  }
  await db.end();
}
