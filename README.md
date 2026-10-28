# Posting Center — Dr. Sands

A private Next.js / TypeScript / Tailwind portal deployed from
[CoreyOutlier/SandsMedia](https://github.com/CoreyOutlier/SandsMedia) to
[sandsmedia-platform](https://vercel.com/outlier-creative-agency/sandsmedia-platform).
The temporary test origin is https://sandsmedia-platform.vercel.app.

The specification is [docs/BRIEF.md](docs/BRIEF.md). The
[prototype](docs/prototype.html) is reference material, never served or embedded.

## Current checkpoint: step 1, not complete

Implemented: branded sign-in screen, Google Auth.js integration with verified-email
allowlisting, protected empty Patients and Other uploads libraries, mobile navigation,
light theme, web app manifest/icons, Prisma schema, unapplied initial migration, and
an explicit fixture seed script. The actual wordmark and palette were extracted from
the official website with owner approval. Roboto and Open Sans are self-hosted; font
licenses are in public/brand/fonts.

Validated locally: production build, TypeScript, Prisma schema, access/clearance unit
tests, anonymous HTTP checks, authenticated route checks using synthetic local test
sessions, and desktop/mobile sign-in rendering. No real Google OAuth exchange or
Neon/Drive operation has been validated. SQL consent guards have not yet been run
against a database.

Still required for step 1: configure Google login and Neon credentials, apply and test
the reviewed migration with separate migration/runtime database roles, initialize the
clinic, seed a development database, verify real Google login/denial, and connect the
clinic's custom subdomain. Do not call this checkpoint a completed upload portal.
Steps 2–7 require the owner's go-ahead after the preceding step.

## Two libraries

The owner added Other uploads on 2026-10-28. Patients retain the exact patient/session
consent model. Other uploads uses separate GeneralUpload and GeneralMedia tables for
clinic/team/general footage, without inventing patient records. General media is
private to the clinic and agency team; it has no patient clearance badge or public
share route. It must not be used to bypass the patient consent flow.

Drive auth is **Shared Drive + service account**, as selected by the owner. No
personal-Drive refresh-token option is implemented. Dashboard Google OAuth is separate.
Future Drive structure: existing `Patients/{Last, First – ID}/{date treatment}` stays
unchanged; general footage will use `Other uploads/{date title – upload ID}`.

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
| GOOGLE_SERVICE_ACCOUNT_JSON | Base64 service-account JSON key; server only; needed in step 2. |
| DRIVE_ROOT_FOLDER_ID | Posting Center Shared Drive/root ID. |
| AUTH_SECRET | Independent cryptographically random Auth.js session secret. |
| AUTH_GOOGLE_ID | Google OAuth client ID for dashboard sign-in. |
| AUTH_GOOGLE_SECRET | Google OAuth client secret for dashboard sign-in. |
| ALLOWED_EMAILS | Comma-separated exact Google email allowlist; empty denies all access. |
| COOKIE_SECRET | Independent random secret for the upload passcode cookie, needed in step 3. |
| SHARE_SECRET | Independent random secret for signed media links, needed by sharing. |
| MAX_VIDEO_MB | Video upload cap; default 500. |
| CONSENT_TEXT_VERSION | Initial value 1; must match the code's consent version. |
| SEED_DEMO_DATA | Development-only fixture switch; default false. Never set true in Vercel production. |
| SEED_CLINIC_PASSCODE_HASH | Bcrypt hash for initial clinic provisioning; never the raw passcode. |
| NODE_ENV | Set by Node/Next.js; seed forbids demo mode when production. Do not override in Vercel. |
| VERCEL_ENV | Set by Vercel; seed forbids demo mode when production. Do not override. |

Google OAuth must allow `https://sandsmedia-platform.vercel.app/api/auth/callback/google`.
Add the corresponding callback for the selected clinic subdomain before changing APP_URL.
The custom clinic subdomain has not yet been supplied. OAuth client secrets, Neon
connection credentials, service-account keys and passcodes belong in secure settings,
not chat, source code, screenshots, or git.
