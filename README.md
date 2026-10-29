# Posting Center — Dr. Sands

A private Next.js / TypeScript / Tailwind portal deployed from
[CoreyOutlier/SandsMedia](https://github.com/CoreyOutlier/SandsMedia) to
[sandsmedia-platform](https://vercel.com/outlier-creative-agency/sandsmedia-platform).
The temporary test origin is https://sandsmedia-platform.vercel.app.

The specification is [docs/BRIEF.md](docs/BRIEF.md). The
[prototype](docs/prototype.html) is reference material, never served or embedded.

## Current release: complete portal implementation

On 29 October 2026 the owner authorized finishing the remaining steps without
waiting between checkpoints, and reported that saving was unavailable. The upload
form no longer silently disables Save for missing selections: it explains what is
missing and focuses that field. Adding a patient pre-fills the name typed in search
for review. Network timeouts produce retry guidance and preserve upload identity.
Production contained no patient upload attempts when checked, consistent with a
pre-submit block. The owner’s exact failure mode has not yet been supplied; do not
claim a confirmed root cause merely from this usability fix.

Implemented across steps 4–7:

- Patients and Other uploads directories, 150 ms debounced search, combined
  clearance/media filters, pagination, private thumbnails, session details,
  before/after pairing, video playback with byte ranges, and caption copy.
- Ready/Posted status with server-enforced whole-patient clearance; consent
  withdrawal revokes every link and identifies already-posted sessions for removal.
- 256-bit hashed share tokens, 1/7/30-day expiry (7 default), optional bcrypt PIN,
  per-device PIN cookie, view log, link revocation, a branded recipient page with
  sliders, and a patient-free Open Graph image. Sharing uses the native share sheet
  or copy after the link has been prepared.
- Streaming originals and ZIP downloads, private Open in Drive links, clinic name,
  passcode rotation, allowlist view, and a storage-check control.
- Nightly Drive reconciliation at 08:00 UTC. It recovers preallocated uploaded files
  from existing manifests, reports missing/misplaced files, and never guesses patient
  identity or mutates consent. Vercel authenticates it with CRON_SECRET.

Production upload release 52b3cf3 was verified with an actual photo/video batch.
This complete-portal update has passed local build/type checks, 20 unit tests,
authentication checks and the isolated real-Drive integration suite. Commit
`b4f4479` is deployed successfully to production (Vercel deployment
`Fsh9anuTECUzMDk2pp3tSs7RGYBj`). Production checks verified the new Save feedback,
protected pages, a generated 9 MiB video uploaded in two resumable chunks, playback,
and an original download matching the upload byte for byte. SHARE_SECRET and
CRON_SECRET are generated privately but not yet saved in Vercel: the browser
credential-save approvals remain unanswered. Sharing is visibly disabled until
configured, and the nightly endpoint fails closed without its secret. These two
features are implemented and integration-tested but are not yet activated in production.

Verification: a fresh mixed patient upload, name/treatment searches, both libraries,
private thumbnails, video ranges and invalid ranges, a stream larger than 8 MiB,
original download, private/shared ZIP contents with CRC checks, PIN rejection and
throttling, hashed tokens, view counts, revoked media denial, consent withdrawal,
passcode-cookie invalidation, upload-only access isolation, and reconciliation.
With 500 synthetic patients, warm API search measured 80 ms median / 88 ms maximum
from this workstation; the cold first request measured 420 ms. This is not a network
latency guarantee. The 390 px mobile layout had no horizontal overflow and all
visible interactive controls met 44 px minimum height; video metadata and scrubber
loaded successfully in that layout.

All fixtures are isolated in sandsmedia_upload_test and a clearly labeled test
Drive folder. No synthetic patient rows are inserted into production. The two
production general-upload verification batches contain only generated test media.
Real iPhone cellular timing, the 150 MB airplane-mode test, and actual iMessage
preview delivery remain manual device acceptance checks; desktop/emulated tests
must not be represented as those checks.

The owner confirmed the required Google Workspace and database privacy agreements
on 29 October 2026. Production uses SYNTHETIC_TEST_MODE=false on that confirmation;
agreement documents have not been independently audited. Test environments default
to the sample-data notice. The owner does not own the originally suggested custom
domain; no DNS change was made. Use https://sandsmedia-platform.vercel.app.

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
search requirements are recorded in docs/BRIEF.md with acceptance tests. The upload and folder flows have passed isolated integration checks; directory browsing/search and sharing are implemented in the current release.

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
| SHARE_SECRET | Independent random secret for signed media/download capabilities and PIN cookies. Required for sharing. |
| CRON_SECRET | Independent random bearer secret Vercel uses for the nightly storage reconciliation route. |
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

## Additional implementation choices

- Search uses parameterized Postgres ILIKE predicates backed by the existing trigram
  indexes and returns aggregates in one query to avoid sequential relation fetches.
  Search text stays in POST bodies, never URL queries or logs.
- Private Drive files do not offer a general-purpose pre-signed download URL for
  anonymous recipients. Single files stream through the authenticated/signed proxy,
  just as videos do, instead of redirecting to a Drive page requiring another login.
  Thumbnails are credentialed server-side requests because private thumbnailLink
  URLs require authorization. No Drive sharing permissions change.
- Portal ZIPs include the patient/general folder files, including consent.json where
  present. Public ZIPs contain only consented session media and exclude consent
  audit documents (IP/user-agent details). ZIP/video responses stream with
  backpressure, with a 300-second function limit and no disk buffering.
- Media capabilities expire after 15 minutes and share pages refresh them. Every
  request also checks current revocation, expiry, withdrawal and session consent.
  An already downloaded file cannot be recalled by revoking a link.
- Link creation and opening the phone share sheet use two explicit buttons so the
  second action retains browser user activation. The raw link is displayed only in
  the creation result, never recovered from the database.
- OG previews use the real wordmark and a recognized treatment category. Arbitrary
  treatment text is replaced with “Cosmetic dentistry” so names entered into a
  treatment field cannot leak through a preview.
- All allowlisted dashboard accounts share the settings permissions specified in
  the brief; clinic passcode access permits uploads/patient selection only.
- archiver 8 exports ZipArchive; no separate type package was added. The existing
  fflate transitive dependency is pinned to its patched 0.7.5 version via an override;
  npm audit reports no known vulnerabilities as of this release.

Run `node --env-file=.env.upload-test scripts/portal-integration.mjs` for the complete
isolated workflow tests. They refuse non-local origins and non-test databases,
create synthetic fixtures, revoke their test links, withdraw the test patient's
consent, and exercise passcode rotation only in the isolated clinic. Test credentials
and ZIP artifacts remain under ignored environment/qa paths.

Streaming/thumbnail implementation follows the official references:
[Vercel streaming responses](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
and [Drive private thumbnail authorization](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
