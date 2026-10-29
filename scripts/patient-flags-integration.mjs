// Synthetic-only acceptance for shared-team patient collections.
// Never log identities, patient fields, request bodies, tokens or raw errors.
import assert from 'node:assert/strict';
import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto';
import {encode} from 'next-auth/jwt';
import pg from 'pg';

let stage = 'isolation', db, origin, ownerCookie, passcodeCookie, deniedCookie;
const patients = [], sessions = [], media = [], consent = [], links = [], views = [];
const fixtureKey = randomUUID().replaceAll('-', '');
const caseSearch = `Flagcase${fixtureKey}`;
const pageSearch = `Flagpage${fixtureKey}`;
const shareToken = randomBytes(32).toString('base64url');
let otherClinicId;

async function api(path, body, {expected = 200, cookie = ownerCookie, requestOrigin = origin} = {}) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {cookie, origin: requestOrigin, 'Content-Type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.json();
  if (response.status !== expected) {
    const code = typeof result.error === 'string' && /^[A-Z_]+$/.test(result.error) ? result.error : 'UNKNOWN';
    throw new Error(`HTTP_${response.status}_${code}`);
  }
  assert.match(response.headers.get('cache-control') ?? '', /private/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return result;
}

function fixture(clinicId, {label, collection = caseSearch, favorite = false, celebrity = false, archived = false, withdrawn = false, kind, cleared = false, posted = false} = {}) {
  const patient = {
    id: randomUUID(), clinic_id: clinicId, display_id: `FLAG-${fixtureKey}-${patients.length}`,
    first_name: collection, last_name: label ?? `Synthetic ${patients.length}`,
    drive_folder_id: `synthetic-flags-folder-${randomUUID()}`,
    is_favorite: favorite, is_celebrity: celebrity,
    archived_at: archived ? '2026-10-28T12:00:00.000Z' : null,
    consent_withdrawn_at: withdrawn ? '2026-10-28T11:00:00.000Z' : null,
    lifecycle_version: archived || withdrawn ? 1 : 0,
  };
  patients.push(patient);
  if (kind) {
    const session = {
      id: randomUUID(), patient_id: patient.id, upload_id: randomUUID(), date: '2026-10-29',
      treatment: `Synthetic ${label} collection check`, status: posted ? 'posted' : cleared ? 'ready' : 'hold',
      drive_folder_id: `synthetic-flags-session-${randomUUID()}`,
    };
    sessions.push(session);
    media.push({id: randomUUID(), session_id: session.id, kind, drive_file_id: `synthetic-flags-media-${randomUUID()}`, file_name: kind === 'photo' ? 'other-01.jpg' : 'other-01.mp4'});
    if (cleared) consent.push({id: randomUUID(), session_id: session.id});
  }
  return patient;
}

async function insertFixtures(sharedPatient) {
  await db.query(`INSERT INTO clinics (id,name,slug,upload_passcode_hash,drive_root_folder_id)
    VALUES ($1,'Synthetic flags isolation',$2,'disabled-test-only',$3)`,
  [otherClinicId, `synthetic-flags-${fixtureKey}`, `synthetic-flags-root-${fixtureKey}`]);
  await db.query(`INSERT INTO patients
    (id,clinic_id,display_id,first_name,last_name,drive_folder_id,is_favorite,is_celebrity,archived_at,consent_withdrawn_at,lifecycle_version)
    SELECT id,clinic_id,display_id,first_name,last_name,drive_folder_id,is_favorite,is_celebrity,archived_at,consent_withdrawn_at,lifecycle_version
    FROM jsonb_to_recordset($1::jsonb) AS f(id uuid,clinic_id uuid,display_id text,first_name text,last_name text,drive_folder_id text,is_favorite boolean,is_celebrity boolean,archived_at timestamptz,consent_withdrawn_at timestamptz,lifecycle_version integer)`,
  [JSON.stringify(patients)]);
  await db.query(`INSERT INTO sessions (id,patient_id,upload_id,date,treatment,uploaded_by,drive_folder_id,status,finished_at)
    SELECT id,patient_id,upload_id,date,treatment,'Automated synthetic test',drive_folder_id,status::"SessionStatus",CURRENT_TIMESTAMP
    FROM jsonb_to_recordset($1::jsonb) AS f(id uuid,patient_id uuid,upload_id uuid,date date,treatment text,drive_folder_id text,status text)`,
  [JSON.stringify(sessions)]);
  await db.query(`INSERT INTO media (id,session_id,kind,label,drive_file_id,file_name,position,width,height,duration_s,bytes)
    SELECT id,session_id,kind::"MediaKind",'other',drive_file_id,file_name,0,640,480,CASE WHEN kind='video' THEN 10 ELSE NULL END,1024
    FROM jsonb_to_recordset($1::jsonb) AS f(id uuid,session_id uuid,kind text,drive_file_id text,file_name text)`,
  [JSON.stringify(media)]);
  await db.query(`INSERT INTO consent_events (id,session_id,consented,form_on_file,consent_text_version,consent_text,consented_by,ip,user_agent)
    SELECT id,session_id,true,true,1,'Synthetic test record only','Automated synthetic test','0.0.0.0','synthetic-test'
    FROM jsonb_to_recordset($1::jsonb) AS f(id uuid,session_id uuid)`, [JSON.stringify(consent)]);
  // An existing active link and view prove that organizational changes do not
  // silently revoke shares, reset access history or affect consent.
  const link = {id: randomUUID(), patient_id: sharedPatient.id, token_hash: createHash('sha256').update(shareToken).digest('hex')};
  links.push(link);
  await db.query(`INSERT INTO share_links (id,patient_id,token_hash,created_by,view_count,last_viewed_at)
    VALUES ($1,$2,$3,'Automated synthetic test',1,CURRENT_TIMESTAMP)`, [link.id, link.patient_id, link.token_hash]);
  const view = {id: randomUUID(), share_link_id: link.id};
  views.push(view);
  await db.query(`INSERT INTO share_views (id,share_link_id,ip,user_agent) VALUES ($1,$2,'0.0.0.0','synthetic-test')`, [view.id, view.share_link_id]);
}

async function invariants() {
  const ids = patients.map(patient => patient.id);
  const queries = [
    ['SELECT id,clinic_id,display_id,first_name,last_name,drive_folder_id,consent_withdrawn_at,lifecycle_version,archived_at,created_at FROM patients WHERE id=ANY($1::uuid[]) ORDER BY id', ids],
    ['SELECT * FROM sessions WHERE patient_id=ANY($1::uuid[]) ORDER BY id', ids],
    ['SELECT m.* FROM media m JOIN sessions s ON s.id=m.session_id WHERE s.patient_id=ANY($1::uuid[]) ORDER BY m.id', ids],
    ['SELECT c.* FROM consent_events c JOIN sessions s ON s.id=c.session_id WHERE s.patient_id=ANY($1::uuid[]) ORDER BY c.id', ids],
    ['SELECT * FROM patient_activities WHERE patient_id=ANY($1::uuid[]) ORDER BY id', ids],
    ['SELECT * FROM share_links WHERE patient_id=ANY($1::uuid[]) ORDER BY id', ids],
    ['SELECT v.* FROM share_views v JOIN share_links l ON l.id=v.share_link_id WHERE l.patient_id=ANY($1::uuid[]) ORDER BY v.id', ids],
    ['SELECT * FROM upload_batches WHERE session_id=ANY($1::uuid[]) ORDER BY id', sessions.map(session => session.id)],
  ];
  const results = [];
  // One pg connection executes serially; do not enqueue simultaneous queries.
  for (const [sql, keys] of queries) results.push((await db.query(sql, [keys])).rows);
  return results;
}

async function flags(id) {
  return (await db.query('SELECT is_favorite,is_celebrity FROM patients WHERE id=$1', [id])).rows[0];
}

async function expectRows(query, expectedPatients) {
  const result = await api('/api/library', {q: caseSearch, ...query});
  assert.equal(result.more, false);
  assert.deepEqual(result.rows.map(row => row.id).sort(), expectedPatients.map(patient => patient.id).sort());
  for (const row of result.rows) {
    const expected = await flags(row.id);
    assert.equal(row.isFavorite, expected.is_favorite);
    assert.equal(row.isCelebrity, expected.is_celebrity);
  }
  return result;
}

try {
  origin = process.env.APP_URL;
  assert.equal(origin, 'http://localhost:3102');
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/sandsmedia_upload_test');
  assert.ok((process.env.ALLOWED_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).includes('allowed@example.test'));
  db = new pg.Client({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20000});
  await db.connect();
  const clinic = (await db.query('SELECT id,upload_passcode_hash,drive_root_folder_id FROM clinics WHERE slug=$1', [process.env.CLINIC_SLUG ?? 'dr-sands'])).rows[0];
  assert.ok(clinic);
  assert.equal(clinic.drive_root_folder_id, process.env.DRIVE_ROOT_FOLDER_ID);
  const cookieFor = async email => `authjs.session-token=${await encode({secret: process.env.AUTH_SECRET, salt: 'authjs.session-token', token: {sub: 'patient-flags-test', email, verifiedGoogle: true}, maxAge: 3600})}`;
  ownerCookie = await cookieFor('allowed@example.test');
  deniedCookie = await cookieFor('not-allowed@example.test');
  const sign = value => createHmac('sha256', process.env.COOKIE_SECRET ?? process.env.AUTH_SECRET).update(value).digest('hex');
  const payload = Buffer.from(JSON.stringify({clinicId: clinic.id, passcodeVersion: sign(clinic.upload_passcode_hash), expires: Date.now() + 3600000, id: randomUUID()})).toString('base64url');
  passcodeCookie = `posting-center-upload=${payload}.${sign(payload)}`;

  stage = 'fixtures';
  otherClinicId = randomUUID();
  const editable = fixture(clinic.id, {label: 'Editable', kind: 'photo', cleared: true, posted: true});
  const celebrity = fixture(clinic.id, {label: 'Celebrity', celebrity: true, kind: 'video', cleared: true});
  const favorite = fixture(clinic.id, {label: 'Favorite', favorite: true, kind: 'photo'});
  const both = fixture(clinic.id, {label: 'Both', favorite: true, celebrity: true, kind: 'video', withdrawn: true, cleared: true});
  const archived = fixture(clinic.id, {label: 'Archived', favorite: true, celebrity: true, archived: true, kind: 'photo', cleared: true});
  const foreign = fixture(otherClinicId, {label: 'Foreign', favorite: true, celebrity: true, kind: 'video', cleared: true});
  const paged = Array.from({length: 53}, (_, index) => fixture(clinic.id, {label: `Page ${index}`, collection: pageSearch, favorite: true, celebrity: index % 2 === 0}));
  await insertFixtures(editable);
  const before = await invariants();
  const path = `/api/patients/${editable.id}`;

  stage = 'default_false';
  // SQL column defaults are checked separately from explicit fixture flags.
  const defaults = (await db.query(`SELECT column_name,column_default,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='patients' AND column_name IN ('is_favorite','is_celebrity') ORDER BY column_name`)).rows;
  assert.equal(defaults.length, 2);
  assert.ok(defaults.every(column => column.column_default === 'false' && column.is_nullable === 'NO'));
  const original = await api(path);
  assert.equal(original.isFavorite, false); assert.equal(original.isCelebrity, false);

  stage = 'set_retry_and_independence';
  let result = await api(path, {action: 'favorite', value: true});
  assert.equal(result.isFavorite, true); assert.equal(result.isCelebrity, false);
  assert.deepEqual(await api(path, {action: 'favorite', value: true}), result);
  result = await api(path, {action: 'celebrity', value: true});
  assert.equal(result.isFavorite, true); assert.equal(result.isCelebrity, true);
  assert.deepEqual(await api(path, {action: 'celebrity', value: true}), result);
  result = await api(path, {action: 'favorite', value: false});
  assert.equal(result.isFavorite, false); assert.equal(result.isCelebrity, true);
  await api(path, {action: 'celebrity', value: false});
  await Promise.all([api(path, {action: 'favorite', value: true}), api(path, {action: 'celebrity', value: true})]);
  assert.deepEqual(await flags(editable.id), {is_favorite: true, is_celebrity: true});
  result = await api(path);
  assert.equal(result.isFavorite, true); assert.equal(result.isCelebrity, true);

  stage = 'strict_boolean_validation';
  for (const action of ['favorite', 'celebrity']) {
    for (const value of [undefined, null, 'true', 'false', 1, 0, [], {}]) {
      const rejected = await api(path, {action, value}, {expected: 400});
      assert.equal(rejected.error, 'INVALID_FIELDS');
    }
  }
  assert.deepEqual(await flags(editable.id), {is_favorite: true, is_celebrity: true});

  stage = 'auth_origin_and_clinic_isolation';
  for (const cookie of ['', passcodeCookie, deniedCookie]) {
    assert.equal((await api(path, {action: 'favorite', value: false}, {expected: 401, cookie})).error, 'SIGN_IN_REQUIRED');
    await api('/api/library', {collection: 'celebrities'}, {expected: 401, cookie});
  }
  await api(path, {action: 'favorite', value: false}, {expected: 403, requestOrigin: 'https://untrusted.example.test'});
  for (const id of [foreign.id, randomUUID()]) {
    await api(`/api/patients/${id}`, undefined, {expected: 404});
    for (const action of ['favorite', 'celebrity']) await api(`/api/patients/${id}`, {action, value: false}, {expected: 404});
  }
  assert.deepEqual(await flags(foreign.id), {is_favorite: true, is_celebrity: true});

  stage = 'composed_filters';
  await expectRows({collection: 'all'}, [editable, celebrity, favorite, both]);
  await expectRows({collection: 'favorites'}, [editable, favorite, both]);
  await expectRows({collection: 'celebrities'}, [editable, celebrity, both]);
  await expectRows({collection: 'favorites', media: 'video'}, [both]);
  await expectRows({collection: 'celebrities', media: 'video', filter: 'cleared'}, [celebrity]);
  await expectRows({collection: 'celebrities', filter: 'hold'}, [both]);
  await expectRows({collection: 'favorites', filter: 'posted'}, [editable]);
  await expectRows({collection: 'celebrities', archive: 'archived', media: 'photo'}, [archived]);
  await expectRows({collection: 'celebrities', archive: 'all'}, [editable, celebrity, both, archived]);
  await expectRows({collection: 'favorites', q: editable.display_id, filter: 'posted'}, [editable]);
  await expectRows({collection: 'celebrities', q: `${caseSearch} Synthetic Celebrity collection`, media: 'video'}, [celebrity]);
  await expectRows({collection: 'favorites', q: `${caseSearch} unmatched`}, []);

  stage = 'collection_validation';
  for (const collection of [null, false, 1, [], {}, 'favorite', 'unknown']) {
    assert.equal((await api('/api/library', {collection}, {expected: 400})).error, 'INVALID_FIELDS');
  }
  for (const collection of ['favorites', 'celebrities']) {
    assert.equal((await api('/api/library', {general: true, collection}, {expected: 400})).error, 'INVALID_FIELDS');
  }
  const general = await api('/api/library', {general: true, collection: 'all', q: caseSearch});
  assert.deepEqual(general.rows, []);

  stage = 'pagination';
  const first = await api('/api/library', {q: pageSearch, collection: 'favorites'});
  const second = await api('/api/library', {q: pageSearch, collection: 'favorites', offset: 50});
  assert.equal(first.rows.length, 50); assert.equal(first.more, true);
  assert.equal(second.rows.length, 3); assert.equal(second.more, false);
  const combined = [...first.rows, ...second.rows];
  assert.equal(new Set(combined.map(row => row.id)).size, 53);
  assert.deepEqual(combined.map(row => row.id).sort(), paged.map(patient => patient.id).sort());
  assert.ok(combined.every(row => row.isFavorite === true));
  for (const row of combined) assert.equal(row.isCelebrity, paged.find(patient => patient.id === row.id).is_celebrity);

  stage = 'archived_and_withdrawn_remain_independent';
  for (const patient of [archived, both]) {
    const itemPath = `/api/patients/${patient.id}`;
    const expectedStatus = patient.archived_at ? 'archived' : 'withdrawn';
    result = await api(itemPath, {action: 'favorite', value: false});
    assert.equal(result.isFavorite, false); assert.equal(result.isCelebrity, true);
    assert.equal(result.clearance.status, expectedStatus);
    await api(itemPath, {action: 'favorite', value: true});
  }

  stage = 'patient_and_consent_invariants';
  const publicView = await api('/api/share-view', {token: shareToken, refresh: true}, {cookie: ''});
  assert.equal(Object.hasOwn(publicView, 'isFavorite'), false);
  assert.equal(Object.hasOwn(publicView, 'isCelebrity'), false);
  assert.equal(publicView.sessions.length, 1);
  assert.deepEqual(await invariants(), before);
  assert.equal((await api(path)).clearance.status, original.clearance.status);
  console.info('PATIENT_FLAGS_INTEGRATION_PASS_DEFAULTS_SET_RETRY_CONCURRENT_INDEPENDENCE_STRICT_BOOLEANS_AUTH_ORIGIN_CLINIC_SCOPE_FILTERS_PAGINATION_PUBLIC_PRIVACY_CONSENT_SHARES_LIFECYCLE_MEDIA_UNCHANGED');
} catch (error) {
  const safeCode = /^HTTP_[0-9]+_[A-Z_]+$/.test(error?.message ?? '') ? `_${error.message}` : /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? `_DATABASE_${error.code}` : '';
  console.error(`PATIENT_FLAGS_INTEGRATION_FAILED_${stage.toUpperCase()}${safeCode}`);
  process.exitCode = 1;
} finally {
  if (db) {
    try {
      // Keep immutable synthetic consent history; hide only this run's records.
      // This cleanup runs only after the hard application/database guards above.
      await db.query('UPDATE patients SET archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP),is_favorite=false,is_celebrity=false WHERE id=ANY($1::uuid[])', [patients.map(patient => patient.id)]);
      console.info('SYNTHETIC_PATIENT_FLAGS_FIXTURES_ARCHIVED');
    } catch { console.error('PATIENT_FLAGS_FIXTURE_CLEANUP_FAILED'); process.exitCode = 1; }
    await db.end().catch(() => {});
  }
}
