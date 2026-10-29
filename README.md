# Posting Center — Dr. Sands

A private Next.js / TypeScript / Tailwind portal deployed from
[CoreyOutlier/SandsMedia](https://github.com/CoreyOutlier/SandsMedia) to
[sandsmedia-platform](https://vercel.com/outlier-creative-agency/sandsmedia-platform).
The temporary test origin is https://sandsmedia-platform.vercel.app.

The specification is [docs/BRIEF.md](docs/BRIEF.md). The
[prototype](docs/prototype.html) is reference material, never served or embedded.

## Favorites and celebrities — 29 October 2026

Patient records have independent Favorite and Celebrity markers shared across the
clinic team. Star a patient from the directory or use the Favorite / Celebrity
controls in their record. The Collection dropdown selects All patients, Favorites
or Celebrities and combines with search, consent, media and archive filters.
Celebrity records receive an owner-requested gold badge and accent; consent status
stays visible and continues to control posting and sharing. Markers are internal
only and are omitted from public share data. Other uploads has no patient markers.

Both flags default to false for existing patients. The additive migration is
`prisma/migrations/202610290004_patient_collections/migration.sql`; it adds only
two non-null booleans and clinic-scoped indexes. Authenticated dashboard users can
set either flag to an explicit boolean. Clinic upload-passcode access cannot do
so. Assignments are retry-safe and do not change files, consent, lifecycle history
or existing links. No new dependencies or environment variables are required.

Apply with the separate database owner connection, never the runtime login:
`node --env-file=.env.upload-test-admin scripts/patient-collections-migrate.mjs test`
for the isolated test database. The runner's production mode additionally requires
the production clinic/Drive configuration and checks database identity, record
counts, defaults, runtime privileges and immutable audit protections before and
after migration. Run `scripts/patient-flags-integration.mjs` with
`.env.upload-test` against the local production build on port 3102; it refuses
other databases and origins and uses only synthetic records, without Drive calls.

The migration has been applied to both test and production, with aggregate record
counts preserved and consent/history protections verified. All 54 unit tests, the
production build, HTTP smoke checks and authenticated route checks passed. The
isolated integration verified independent flags, repeated/concurrent assignments,
strict validation, clinic and login boundaries, composed filters, 53-record
pagination and public-share exclusion. Existing consent, media and link records
remained unchanged. A late detail/list response cannot overwrite a saved marker.
Desktop and 390 px browser checks confirmed saved toggles after reload, removal
from Favorites without losing the open record, the gold Celebrity treatment,
working collection filters, 44 px controls, visible focus and no horizontal
overflow. Other uploads has no collection controls. Browser checks used synthetic
patient records only.

## Larger and longer video uploads — 29 October 2026

The owner selected **5 GB per video and up to two hours**, for both patient and
Other uploads. This supersedes the original 500 MB / three-minute cap. Set
`MAX_VIDEO_MB=5120`; browser preparation, server validation and Drive metadata
confirmation share the duration policy in `src/lib/upload/limits.ts`. Byte limits
use 1,024-based units. No dependencies, schema migration or new secrets are needed.

Videos remain unchanged, uploaded directly to private Drive in 8 MiB chunks.
Resume validates Drive's acknowledged range, works beyond the 4 GiB boundary,
shows recovered progress immediately, and stops malformed responses after bounded
retries. Pausing also interrupts retry waits. Only Drive's completed response
reports 100%. File sizes display in GB and long durations use hours:minutes:seconds.

Verification includes exact 5 GiB / 7,200-second boundaries, one byte / fractional
second over-limit rejection, invalid metadata, and virtual-file resume tests
beyond 4 GiB without a multi-gigabyte memory allocation. The isolated integration
uses actual 242-second and two-hour MP4s padded to cross an 8 MiB chunk boundary,
checks interrupted/resumed Drive uploads, and finishes them idempotently. It does
not transfer a full 5 GiB file. Real phone/background behavior still depends on
the browser remaining open; keep the page open during long transfers.

To reproduce on macOS (AVFoundation, no extra dependency), generate ignored
fixtures with `swift -module-cache-path /tmp/posting-center-swift-cache
scripts/make-long-video.swift qa/upload-fixtures/synthetic-242s.mp4 242` and
repeat with `synthetic-7200s.mp4 7200`. Existing fixture files are reused. Run the
local production build on port 3102 with `.env.upload-test` and
`MAX_VIDEO_MB=5120`, then run
`MAX_VIDEO_MB=5120 node --env-file=.env.upload-test scripts/test-long-video.mjs`.
The script refuses production origins/databases. Drive may take several minutes
to expose a long video's preview metadata; saving does not wait for transcoding.

Download limitation: portal original/ZIP downloads still stream through a
300-second route. A multi-GB download on a slow connection may exceed that limit;
users with permission to the private Shared Drive can use Open in Drive to
retrieve originals there. This upload change does not redesign large-file
download delivery or make any Drive files public.

## Library redesign, renewed consent, and patient archive — 29 October 2026

The owner requested simpler filters, visible downloads, individual video titles,
renewed consent after withdrawal, and reversible patient removal. This release adds:

- One search and a compact Consent / Media / Library filter bar, with no duplicate
  pill rows. Downloads are visible on every file and in the full-image viewer.
- Each session links directly to its private Photos and Videos folders. A read-only
  production audit verified all seven confirmed files existed in the expected
  private folders, including all three photos; none was missing or public.
- Optional 120-character video titles on upload and editable titles for completed
  videos in both libraries. Drive keeps the category-counter and extension for
  uniqueness. Search includes video titles. Downloads preserve Unicode names.
- Archive/restore retains files and consent history. Archived patients leave the
  default library and upload picker; posting, sharing and new upload activity are
  blocked server-side. Archiving revokes all existing links. Restoring never
  unrevokes them or changes consent status. There is no patient delete endpoint.
- Renewed consent requires explicit confirmation that a new signed form covers all
  completed sessions. A new ConsentEvent is appended per completed session, then a
  separate consent-renewal JSON and CSV entry are written to Drive before withdrawal
  is cleared. Original consent records/files remain unchanged. Old links stay revoked.
- PatientActivity records withdrawal, renewal, archive and restore as append-only
  history. Lifecycle versions prevent a slow renewal from overriding a later action.
  A stable request UUID and per-event mirror locks make concurrent retries safe.

The additive migration is
`prisma/migrations/202610290003_patient_lifecycle_titles/migration.sql`.
It adds archive state/version, video titles, renewal references and a guarded audit
history table; existing withdrawals are copied into history. The runtime role gets
only SELECT/INSERT on the new audit table. No patient contact information is added.
Migration uses the separate owner connection, never the production runtime role.
The Prisma schema additions were shown before applying the test migration.
The migration is also applied in production; pre/post aggregate checks confirmed
existing record counts were preserved and both audit tables remain SELECT/INSERT
only for the runtime login. Node pg uses sslmode=verify-full; the Prisma migration
engine uses its supported sslmode=require&sslaccept=strict combination with the
separate owner connection. See the [Prisma PostgreSQL connector reference](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).

Short database transactions allow 20 seconds with a 10-second pool wait, instead
of the library's previous five-second default that produced observed P2028 errors.
Fresh standalone test-database probes showed slow TLS/authentication, with no
blocked queries or pool saturation. Connections now allow 20 seconds, and idle
connections stay warm for 60 seconds to reduce repeated handshakes. Thumbnail
requests retry once; persistent preview errors show a clear Open file fallback
while keeping Download available. Error logging remains fixed codes only.
No new dependencies or environment variables were introduced.

Verification: all 34 unit tests, production build, authentication and HTTP checks
passed. The synthetic lifecycle workflow passed with no client retries, including
concurrent renewal requests and archive/restore protections. Video naming, stale
renewal rejection, full-file SHA-256 download comparisons and ZIP/range checks
passed. Some earlier checks hit connection timeouts; focused reruns passed. Browser
checks at 390 px found no overflow and all visible controls at least 44 px.

Acceptance scripts use only `sandsmedia_upload_test` and localhost:3102:
`lifecycle-integration.mjs`, `stale-renewal-integration.mjs`,
`media-title-integration.mjs`, and `download-integration.mjs` under `scripts/`.
They verify immutable records, renewal retries, Drive copies, revoked links,
archive/restore, upload isolation, video title consistency and downloaded bytes.
The download is the saved 2048 px JPEG for photos and the unchanged upload for video;
it does not recover the larger pre-compression camera photo.

## Previous release: complete portal implementation

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
- Optional Drive reconciliation (automatic schedule currently off). It recovers preallocated uploaded files
  from existing manifests, reports missing/misplaced files, and never guesses patient
  identity or mutates consent. Vercel authenticates it with CRON_SECRET.

Production upload release 52b3cf3 was verified with an actual photo/video batch.
This complete-portal update has passed local build/type checks, 20 unit tests,
authentication checks and the isolated real-Drive integration suite. Commit
`b4f4479` is deployed successfully to production (Vercel deployment
`Fsh9anuTECUzMDk2pp3tSs7RGYBj`). Production checks verified the new Save feedback,
protected pages, a generated 9 MiB video uploaded in two resumable chunks, playback,
and an original download matching the upload byte for byte. The owner approved
SHARE_SECRET, and it is saved as a production secret in Vercel. On the owner's
storage question, the nightly schedule was removed from vercel.json pending a
storage decision; CRON_SECRET has not been saved. The authenticated manual
Check storage control remains available. The nightly endpoint rejects requests
without its secret. Media remain in private Shared Drive folders; GitHub holds
application code only.

The owner's screenshot confirmed the patient-selection validation was reached.
Save now opens name confirmation directly when a name is typed without selecting
a patient. Search and new-patient entry are separate states, with clear guidance,
so editing a name cannot silently cancel new-patient entry. Nothing is uploaded
until the user reviews the name and submits again.

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

### Explicit media categories

Patient photos and videos begin with no category selected. Every file must be
classified as Before, After, Testimonial, or Other before any upload session starts.
Selection order never assigns a category. General uploads remain Other. Categories
on already-started batches stay locked to preserve the saved manifest, Drive names,
and retry identity; this change does not reclassify existing uploads or consent.

### Preview, navigation and withdrawal feedback

Upload cards, directory thumbnails, and share comparisons fit the whole image
inside their frame rather than cropping it. Original pixels are unaffected.
Navigation prefetches routes and shows a pending label/loading view. The upload
page's readiness check no longer imports the Google API SDK. Drive operations load
only the Drive-specific module from the existing googleapis dependency. Repeated dashboard
auth checks are deduplicated within a render (never shared between users).
Withdrawal shows progress and errors next to its confirmation button and a local
success message. A transient connection/server failure retries withdrawal once,
using the same idempotent action; authorization failures never retry. It avoids a redundant full detail reload after success. Its
transaction reads only patient identity/withdrawal state, instead of loading all
media, and permits 15 seconds for the atomic withdrawal/link revocation. Consent
history remains append-only. The original browser test encountered a transient
request failure; a retry succeeded. This is not proof of the user's exact failure
cause. Database connection establishment is bounded to 10 seconds, idle pooled
connections expire after 10 seconds, and TCP keepalive is enabled. Diagnostics emit
fixed error codes only, never raw upstream errors, request bodies, or patient data.

Verification for this update: the production build, authentication checks, and
23 unit tests pass, including explicit category
validation and a single safe withdrawal retry. Browser checks confirmed blank
initial categories, explicit photo/video choices, uncropped previews, and withdrawal
success feedback. An isolated database/API test confirmed withdrawal, all-link
revocation, unchanged consent-event count, and an unchanged withdrawal timestamp
on retry (2.2 seconds for withdrawal and verification). The broader integration
suite encountered intermittent upstream timeouts; a later run was interrupted when
the isolated database connection became unavailable. Do not represent that broader
suite as passing for this update or these local timings as production guarantees.

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
| CRON_SECRET | Optional random bearer secret for the storage reconciliation route. No automatic schedule is currently configured. |
| SYNTHETIC_TEST_MODE | Defaults true; shows a test-only notice and requires acknowledgement. Set false only after the practice confirms the brief’s patient-data setup. |
| MAX_VIDEO_MB | Video upload cap in binary MB; default and maximum 5120 (5 GB). Every video also has a fixed 7,200-second (2-hour) duration limit in `src/lib/upload/limits.ts`. |
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

## Private uploads after consent withdrawal

Withdrawal blocks posting and external sharing while private uploads and downloads
remain available. Add media stays visible for active withdrawn patients. Each new
session finishes on hold while withdrawal is active, even if session consent was
checked. Uploading never clears the withdrawal or restores revoked links. New
session consent events remain append-only; the existing consent sentence and
version are unchanged. Archived patients still require restoration before upload.

Run `node --env-file=.env.upload-test scripts/withdrawn-upload-integration.mjs`
against the isolated localhost test server to exercise mixed uploads after
withdrawal, resume/retry, consent preservation, social-access denial, and archives.
No schema migration, additional dependency, or new environment variable is needed.

## Upload recovery

A rejected first start validation unlocks the existing draft and removes its stale
resume hint without discarding selected files. Network failures and ambiguous
responses retain the same upload UUID for idempotent retries. If an old hint cannot
be recovered, the upload screen offers Try resume again, Check saved files, and
Start a new upload. It never automatically creates a replacement or changes batch
ownership. Only the original authenticated uploader can resume that batch.

Browser session storage contains only the pending UUID, never patient details.
Restoring an upload retains matching selections, applies the saved labels/titles,
and discards unrelated previews. Completed batches show Finish saving.

Run `node --env-file=.env.upload-test scripts/resume-integration.mjs` against the
local test server for rejected starts, missing hints, original-uploader recovery,
strict ownership, concurrent retries, and lost-response recovery without duplicate
patients or sessions. No schema, dependency, or environment change is required.
