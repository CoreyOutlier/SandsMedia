You are building Posting Center, Dr. Sands' photo portal (cosmetic dentist, Beverly Hills): a live Next.js site on Vercel where his team uploads before/after photos and videos from their phones into Google Drive with consent recorded at upload, and where my agency team searches patients, sees whether each is cleared for social, filters photos vs videos, downloads originals, and shares a patient by text as a branded expiring page.

Read these two files fully before doing anything else:
- docs/BRIEF.md, the build brief. It is the spec. Follow its data model, folder structure, upload flow, directory behaviour, share-by-text design, access control and compliance rules exactly.
- docs/prototype.html, the visual reference. Match its three screens (upload, patients, the #share page), copy, layout and light theme. Rebuild it in Next.js, Tailwind and TypeScript; do not import or iframe it.

Decisions already made:
- Drive auth: [Shared Drive + service account | OAuth refresh token]. Do not implement the other.
- Database: Neon Postgres via Prisma, with a pg_trgm index for search.
- Dashboard auth: Auth.js with Google provider and an email allowlist from ALLOWED_EMAILS.
- Uploads go from the browser straight to Drive through server-minted resumable upload sessions, chunked with resume. Photos are compressed in the browser to 2048 px JPEG; videos are uploaded as-is up to MAX_VIDEO_MB. Nothing is written to Vercel Blob or disk.
- Share links: hashed tokens, 7-day default expiry, revoke, view log, OG image with no patient name or photo, cleared sessions only.
- Mobile first. Every control at least 44 px tall. Web app manifest so it installs to the home screen.

Work through the seven build steps in the brief in order. After each step: run the app locally, run the tests you wrote, commit with a message that names the step, and stop to report what works, what is stubbed, and anything in the brief you had to deviate from and why. Do not start the next step until I say go.

Rules:
- Never log request bodies, patient names or file names. Redact them in error reporting.
- Never store date of birth, phone, email or address for a patient. Name and display ID only.
- ConsentEvent rows are append-only. No update or delete path may exist for them.
- Keep the consent sentence as a constant with CONSENT_TEXT_VERSION; bump the version if the wording changes.
- Put every env var in .env.example with a placeholder and document it in README.md.
- Ask before adding any dependency not named in the brief.
- Brand it as Dr. Sands' own portal: logo, hex colours and typeface from docs/brand/ (ask me if that folder is empty), theme pinned to light.

Start with step 1 now and show me the Prisma schema before you run the migration.
