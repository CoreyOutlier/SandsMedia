# Posting Center — Dr. Sands

A private Next.js / TypeScript / Tailwind portal deployed from
[CoreyOutlier/SandsMedia](https://github.com/CoreyOutlier/SandsMedia) to
[sandsmedia-platform](https://vercel.com/outlier-creative-agency/sandsmedia-platform).
The temporary test origin is https://sandsmedia-platform.vercel.app.

The specification is [docs/BRIEF.md](docs/BRIEF.md). The
[prototype](docs/prototype.html) is reference material, never served or embedded.

## Current checkpoint: steps 2 and 3, uploads deployed

The owner asked to proceed with the actual upload form. The production release now has
`/upload` for the five approved Google accounts and `/u/dr-sands` for clinic passcode
access. It accepts a patient or a titled general upload, multiple photos and videos
in one batch, treatment/title, date, description, uploader, per-file labels and the
versioned consent flags. Photos are converted in the browser to 2048 px JPEG with
EXIF removed; videos remain unchanged, up to the configured cap and three minutes.
Files go directly from the browser to Drive in sequential, resumable 8 MiB chunks.
The server never receives uploaded media bytes and never writes them to disk.

Verified on 29 October 2026: TypeScript, production build, 15 unit tests, local
access checks, a real browser batch with two photos and one video, a second upload
for the same patient, and database/Drive verification of folders and consent.
Integration checks against the real Drive API also passed partial-chunk resume,
repeated start/sign/confirmation/finish, rejection of incomplete batches, ownership
isolation, and two separate general uploads with the same title. Test records live
in a separate `sandsmedia_upload_test` database and clearly labeled synthetic Drive
folder. No patient fixtures are inserted into production.

The production database has both migrations and an initialized clinic. The runtime
login remains restricted, including append-only consent permissions. Drive API is
enabled in the dedicated SandsMedia Cloud project. Its service account is Content
manager only in the dedicated Shared Drive; Corey is the other member. The Drive
credential, root ID and independent upload-cookie secret have been saved as Production
secrets in Vercel.

Upload release `52b3cf3` deployed successfully to Vercel on 29 October 2026.
Production access/header checks and a real allowlisted Google sign-in passed; both
upload forms render with the confirmed production settings. A generated photo and
video were uploaded together through the production browser form and completed in
a titled Other uploads folder with separate Photos and Videos folders. This clearly
labeled verification batch contains no patient information.
The Patients and Other uploads library views remain
placeholders for step 4: saved files are available through the success screen's
Drive link, and patient selection searches existing records. Full library browsing,
media playback/downloads, share links, consent withdrawal and admin controls remain
subsequent steps. Do not describe this as the completed seven-step portal.

The original proposed custom domain was removed after the owner clarified they do
not own it. No DNS changes were made. Use https://sandsmedia-platform.vercel.app.
The owner confirmed the required Google Workspace and database privacy agreements
on 29 October 2026. Production is configured with SYNTHETIC_TEST_MODE=false based
on that confirmation; agreement documents have not been independently audited.
Local environments default to synthetic-test mode, displaying a notice and required
acknowledgement. This is not an automatic detector of patient information.
Real-phone cellular timing, a 150 MB upload with airplane-mode interruption, and
an actual non-allowlisted Google sign-in still require acceptance testing.

### Implementation details and brief deviations

- Patient search uses a bounded POST body rather than a URL query, to keep patient
  names out of request URLs and access logs. All errors use fixed codes.
- `UploadBatch` stores the immutable upload intent, file manifest, owner hash and
  Photos/Videos folder IDs. Resumable URLs are encrypted at rest and omitted from
  status responses. Only an opaque pending upload UUID is stored in sessionStorage;
  names and other form fields remain in React state. After a browser restart,
  the authenticated user reselects unfinished files to resume.
- `/api/uploads/{batchId}` uses the client upload UUID as its stable route ID;
  the database retains the session/general-upload relation. Folder provisioning
  happens on the first signing request, after start persists the retryable intent.
- One patient folder is reused. Patient session names receive a short upload-ID
  suffix only on a same-name collision. General folders always include a suffix.
- Consent is committed before its Drive mirrors, so a failed Drive request cannot
  produce a mirror of a rolled-back event. Finish retries reuse the original event
  and mirror entry. A batch is finished only after every file and required mirror
  is verified. Unticked consent creates neither an event nor consent.json, following
  the brief's acceptance criterion. No consent update/delete/upsert path exists.
- Drive has no byte-append endpoint: the CSV mirror is replaced with its exact
  existing bytes plus the new row while holding a clinic lock. The database is the
  permanent append-only authority. A conflicting mirror stops finalization.

## Two libraries

The owner added Other uploads on 2026-10-28. Patients retain the exact patient/session
consent model. Other uploads uses separate GeneralUpload and GeneralMedia tables for
clinic/team/general footage, without inventing patient records. General media is
private to the clinic and agency team; it has no patient clearance badge or public
share route. It must not be used to bypass the patient consent flow.

Drive auth is **Shared Drive + service account**, as selected by the owner. No
personal-Drive refresh-token option is implemented. Dashboard Google OAuth is separate.
Storage provisioned on 28 October 2026 at the owner's request: a dedicated
`Posting Center — Dr. Sands` Shared Drive in the signed-in OCA Workspace account,
containing `Patients` and `Other uploads`. General access is Restricted.
The approved service account is now connected as Content manager; Corey is Manager.
Individual patient/session folders will be created from actual uploads, using
`Patients/{Last, First – ID}/{date treatment}/Photos|Videos`; general footage will use
`Other uploads/{date title – upload ID}/Photos|Videos`. GitHub stores application code,
not media. The owner's mixed-batch, patient-folder reuse, titled general-upload and
search requirements are recorded in docs/BRIEF.md with acceptance tests. The upload and folder flows have passed isolated integration checks; full directory
browsing/search and sharing remain subsequent steps.

## Local development

Use Node 24. Copy `.env.example` to an ignored environment file and supply real values
privately. Next.js loads `.env.local`; Prisma commands read their process environment.
Use Node's environment-file flag when invoking Prisma directly, for example:

```sh
npm ci
node --env-file=.env.local node_modules/prisma/build/index.js generate --config prisma7.config.ts
npm run dev
```

The build uses Next.js's supported webpack compiler because Turbopack's worker-port
binding was unavailable in the local execution environment. No extra bundler package
was added. `vercel.json` explicitly selects Next.js and overrides the original static
import preset. No migration runs during builds or deployment.

```sh
npm run build
npm run typecheck
npm test
npm run start -- --hostname 127.0.0.1 --port 3100
npm run test:smoke -- http://127.0.0.1:3100
npm run test:auth
```

`test:auth` launches an isolated loopback server with ephemeral fake credentials and
no database. It never logs tokens, never connects to Google, and stops its server
when finished. These tests do not replace real-provider acceptance tests.

## Database and consent

Review [prisma/schema.prisma](prisma/schema.prisma) and the
[initial migration](prisma/migrations/202610280001_step_1_foundation/migration.sql)
before running `npm run db:migrate` with the intended database environment.
The migration installs pg_trgm indexes and rejects UPDATE, DELETE, and TRUNCATE on
consent_events. Restrictive foreign keys prevent cascading deletion. The runtime role
must receive only SELECT/INSERT on consent_events and must not own tables or have DDL
privileges. Use a separate privileged role to apply migrations.

The approved runtime role has SELECT/INSERT on consent_events and share_views,
and SELECT/INSERT/UPDATE on the other nine application tables, including
upload_batches and upload_attempts. It has no DELETE,
table ownership, public-schema CREATE, or role-management privileges. Do not reconnect
the Neon integration in a way that adds owner credentials to the runtime environment.

Run `node --env-file=.env.neon-runtime scripts/db-security-check.mjs` against the
restricted connection to check permissions and rejected consent mutations. The
optional `--guards-only` mode checks owner-level triggers using a separate admin
environment and refuses to run unless consent_events is empty. Each attempted
mutation is rolled back; output contains no connection strings or row contents.

No patient birth date, phone, email, or address columns exist. Clearance is derived.
Supporting fields beyond the brief's table summary are: a per-clinic ID counter,
Session.uploadId and finishedAt, testimonialQuote, stable media position, an immutable
consent-text snapshot, and ShareLink.createdAt. Folder IDs are nullable only during
Drive provisioning; signing/finalizing uploads must require provisioned folders.

The brief's finish description conflicts with its acceptance criterion for unticked
consent. Follow the acceptance criterion: hold the session, create no ConsentEvent
and no consent.json. The exact prototype sentence is version 1 in src/lib/consent.ts;
add a new version instead of changing existing wording.

`npm run db:seed` requires a database, Drive root ID and bcrypt passcode hash. By
default it initializes only the clinic without changing an existing clinic or
creating patients. On an explicitly selected development database, SEED_DEMO_DATA=true
inserts the prototype's 8 patients, 11 sessions, 24 photos and 3 videos. Fixture Drive
IDs are clearly synthetic and do not point to actual media. The seed refuses demo
mode in a production environment, skips clinics already containing patients, never
resets data, and never updates/deletes consent rows. Do not enable demo mode against
a production database, even from a local machine.

## Environment

Every configurable variable is listed in `.env.example`. Never commit real secrets.
Never log patient names, filenames, bodies, credentials, or raw data-bearing errors.
Auth error logs are fixed codes only. Secrets must never use NEXT_PUBLIC_ names.

| Variable | Purpose |
| --- | --- |
| APP_URL | Public origin; currently https://sandsmedia-platform.vercel.app. |
| CLINIC_SLUG | Single-clinic dashboard scope; dr-sands. Every data query must use its clinic ID. |
| DATABASE_URL | Neon Postgres connection. Use migration-role credentials only for migration commands, runtime credentials in Vercel. |
| GOOGLE_SERVICE_ACCOUNT_JSON | Base64 service-account JSON key; server only; connected to the dedicated Shared Drive. |
| DRIVE_ROOT_FOLDER_ID | Posting Center Shared Drive/root ID. |
| AUTH_SECRET | Independent cryptographically random Auth.js session secret. |
| AUTH_GOOGLE_ID | Google OAuth client ID for dashboard sign-in. |
| AUTH_GOOGLE_SECRET | Google OAuth client secret for dashboard sign-in. |
| ALLOWED_EMAILS | Comma-separated exact Google email allowlist; empty denies all access. |
| COOKIE_SECRET | Independent random secret for the upload passcode cookie, also encrypts resumable upload session URLs. |
| SHARE_SECRET | Independent random secret for signed media links, needed by sharing. |
| SYNTHETIC_TEST_MODE | Defaults true; shows a test-only notice and requires acknowledgement. Set false only after the practice confirms the brief’s patient-data setup. |
| MAX_VIDEO_MB | Video upload cap; default 500. |
| CONSENT_TEXT_VERSION | Initial value 1; must match the code's consent version. |
| SEED_DEMO_DATA | Development-only fixture switch; default false. Never set true in Vercel production. |
| SEED_CLINIC_PASSCODE_HASH | Bcrypt hash for initial clinic provisioning; never the raw passcode. |
| NODE_ENV | Set by Node/Next.js; seed forbids demo mode when production. Do not override in Vercel. |
| VERCEL_ENV | Set by Vercel; seed forbids demo mode when production. Do not override. |

The Neon integration initially provisioned the following aliases. They were removed
from Vercel during the approved restricted-role transition; the app reads only
DATABASE_URL. Commented placeholders remain in `.env.example` for administrative
tooling. Never expose provisioning/owner credentials to the deployed app.

| Integration variable(s) | Purpose |
| --- | --- |
| DATABASE_URL_UNPOOLED | Direct connection, without the pooler; suitable for migration tooling when using the intended migration role. |
| NEON_PROJECT_ID | Neon resource identifier. |
| PGHOST, PGHOST_UNPOOLED | Pooled and direct Postgres hostnames. |
| PGUSER, PGPASSWORD, PGDATABASE | Connection components for Postgres tooling. |
| POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL | Compatibility connection strings for Vercel Postgres templates; not used by this app. |
| POSTGRES_URL_NO_SSL | Integration compatibility alias; never use it to disable TLS in this app. |
| POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_DATABASE | Compatibility connection components; not used by this app. |

Google OAuth allows only `https://sandsmedia-platform.vercel.app/api/auth/callback/google`.
Keep APP_URL at `https://sandsmedia-platform.vercel.app`. Any future custom domain
must have verified owner authorization and DNS access before configuration.
OAuth client secrets, Neon
connection credentials, service-account keys and passcodes belong in secure settings,
not chat, source code, screenshots, or git.

## Upload verification

`node --env-file=.env.upload-test scripts/upload-integration.mjs` requires the
explicitly isolated test database, local server on port 3102 and a generated
synthetic MP4 in ignored qa/upload-fixtures. It refuses a production database or
non-local origin. It writes only synthetic records and media to the test clinic.
Keep that environment private; it is never copied to Vercel. The clinic upload
passcode is stored only as a bcrypt hash in the database. Rotate it via the later
admin step; existing passcode cookies include a hash version and become invalid
after rotation. Five attempts per IP per 15 minutes are counted in Postgres.
