# Posting Center: build brief for the next agent

Prepared 27 Oct 2026 for Corey Larson (Lumineo). Visual reference: `docs/prototype.html`.

## What this is

Posting Center is Dr. Sands’ own photo portal: a live site at its own address where his team files before/after photos, short videos and testimonials into one Google Drive folder per patient with consent recorded at upload, and where the agency team searches, filters, shares and downloads them for social. Cosmetic dentistry, Beverly Hills. It runs on Vercel from Corey’s GitHub repo and nothing lives in claude.ai.

Two users, three screens:

- **Clinic staff** open the link on their phone, pick the patient or add a new one, take photos or a short video, tag each file Before, After or Testimonial, add a line of description, tick consent and save.
- **Agency team** search as they type, filter by social clearance and by photos or videos, open a patient and see at the top whether that patient is cleared for social, then view before/after pairs, download, mark posted, and share the patient by text.
- **Anyone sent a share link** sees a branded private page with only that patient’s cleared sessions and a before/after slider. It expires.

Done means: a phone photo upload lands in Drive at `Patients / {Patient} / {date}` within 30 seconds and a 150 MB video within a few minutes on cellular; the consent record sits beside the files and in the database; search results update in under 150 ms as you type; a share link opens on an iPhone with his wordmark and a designed preview in iMessage.

## Reference prototype

The clickable preview is `docs/prototype.html` (also hosted at https://claude.ai/artifact/258PDA4t4uxi9qtmNuuZEH). Open it on a phone for the upload flow and on a desktop for the two-pane patient directory. Append `#share` to see the share page. It runs on sample data in memory; nothing it does touches Drive.

What the build should copy from it:

- The screens and their copy: “New upload” with patient picker, photo and video capture, treatment, date, description, uploaded by, consent, “Save to Drive”; “Patients” with search, two filter rows, list, and a detail view of sessions as before/after pairs; the share page.
- Consent is a visible gate, not a hidden checkbox. Unticked uploads still save, but the patient shows “Not cleared” and nothing from them can be marked posted or shared.
- Each file carries one label (Before, After, Testimonial, Other), set by tapping the label on the tile.
- The success screen shows the exact Drive path the files landed in.
- Theme pinned to light, bottom tab bar on phone, left rail on desktop. Before/after pairs render landscape (4:3), which suits smile close-ups.
- Video tiles with a play badge, the Photos / Videos filter row, the full-width “Cleared for social” or “Not cleared” status at the top of every patient, the Share button, and the share page itself (wordmark, first name and last initial, cleared sessions only, before/after slider, expiry line).

It is Dr. Sands’ portal, not Lumineo’s: his wordmark top-left, a light porcelain palette with a gold accent, serif headings. The prototype’s colours and typefaces are stand-ins; swap in the real logo, hex values and typeface from `docs/brand/` before build.

The HTML is a single file with no framework. Treat it as the visual spec; rebuild it in the stack below rather than wrapping it.

## Stack, and the first decision to make

Build it as a Next.js (App Router, TypeScript) app on Vercel, with Google Drive as the file store and a small Postgres database (Neon, via Prisma) as the patient index, consent log and share-link store. Drive alone is not enough: searching Drive by name is slow and fuzzy, and consent needs an audit record you can query, so the database holds patients, sessions, media metadata, consent events and share links, and Drive holds the files.

The decision that shapes everything else is how the server authenticates to Drive. Pick one before writing code.

| Option | Use when | How it works | Watch out for |
| --- | --- | --- | --- |
| Shared Drive + service account (recommended) | Dr. Sands’ practice or Lumineo has Google Workspace | Create a Shared Drive named “Posting Center”, add the service account as Content manager, store its JSON key in an env var | Shared Drives exist only on Workspace plans |
| OAuth refresh token for one Google account | Only a personal Gmail Drive is available | Run a one-time OAuth consent as the account that owns the folder, store the refresh token in an env var, server uses it for every call | One personal account is the single point of failure; a password reset or security review can revoke the token |

Do not point a service account at a folder inside someone’s personal My Drive. Files it uploads there are owned by the service account, count against the service account’s own 15 GB, and cannot be cleanly transferred out.

Other libraries: `googleapis` for Drive, `browser-image-compression` on the client, Auth.js with the Google provider for the dashboard, Tailwind for styling, `archiver` for the zip download, `@vercel/og` for share-link preview images.

Live site: deploy on Vercel at a subdomain of his domain (for example `photos.beverlyhillscosmeticdentist.com`) via a CNAME; Vercel issues the certificate. Ship a web app manifest and icons so staff can add it to the home screen and it opens full-screen like an app. No native app, no app store.

## Drive folder structure and data model

One root folder per clinic, one folder per patient, one folder per session. The patient folder name is `Last, First – ID` so it sorts and stays unique even with duplicate names. The session folder is `YYYY-MM-DD Treatment`. File names carry the label and a counter so pairs line up in Drive without the app.

```text
Posting Center/
  Patients/
    Alvarez, Jordan – DS-0141/
      2026-10-19 Porcelain veneers/
        Photos/
          before-01.jpg
          after-01.jpg
        Videos/
          other-01.mp4
        consent.json
      2026-10-05 Porcelain veneers/
    Bennett, Priya – DS-0138/
  _consent-log.csv        (append-only mirror of the consent table)
```

Owner clarification, 28 October 2026: keep one persistent patient folder and organize
each dated upload into `Photos` and `Videos` child folders. In the app, opening a
patient exposes All media / Photos / Videos across their uploads, retaining date
and treatment grouping. Staff do not need to navigate Drive folders to find media.
Folder identity is the patient ID and upload UUID, never a name/title alone. Two
different patients with the same name remain separate; retrying an upload reuses
its existing folders. Separate uploads on the same date/treatment need distinct
session folders, with a short upload-ID suffix when their display names collide.

`consent.json` is written in the dated session folder alongside its Photos and
Videos folders whenever consent is ticked, so the record travels with the complete
session folder. It holds the patient ID, session date, the exact consent sentence
shown (with a version number), who ticked it, timestamp, IP and user agent.
The media signing and confirmation steps below must use the session's matching
Photos or Videos child folder, and verify that child belongs to the authorized
session. This clarification supersedes the original flat session-file layout;
the necessary folder-ID model changes must be reviewed before a new migration.

Database tables (Prisma):

| Table | Fields | Notes |
| --- | --- | --- |
| Clinic | id, name, slug, upload_passcode_hash, drive_root_folder_id | One row per customer; the slug is in the upload URL |
| Patient | id, clinic_id, display_id (DS-0141), first_name, last_name, drive_folder_id, consent_withdrawn_at, created_at | display_id is sequential per clinic. Social clearance is derived: every session has consent and consent_withdrawn_at is null |
| Session | id, patient_id, date, treatment, description, uploaded_by, drive_folder_id, status (hold, ready, posted), created_at | status is derived from consent at write time and editable only when consent exists |
| Media | id, session_id, kind (photo, video), label (before, after, testimonial, other), drive_file_id, file_name, width, height, duration_s, bytes, created_at | One row per file. Thumbnails come from Drive’s `thumbnailLink` at read time, for videos too |
| ConsentEvent | id, session_id, consented (bool), form_on_file (bool), consent_text_version, consented_by, ip, user_agent, created_at | Append-only. Never update or delete a row |
| ShareLink | id, patient_id, token_hash, pin_hash (nullable), created_by, expires_at, revoked_at, view_count, last_viewed_at | The raw token is shown once and never stored |
| ShareView | id, share_link_id, ip, user_agent, created_at | One row per open of a share page |

Drive IDs are the source of truth for files; the database is the index. If they ever disagree, a nightly job should re-list the patient folder and reconcile.

## Upload flow

Files go from the phone straight to Drive. Vercel never handles the bytes: serverless functions cap request bodies at 4.5 MB, videos run into the hundreds of MB, and keeping media off Vercel is also the compliance position. The server only mints a Drive resumable upload session per file and the browser PUTs the bytes to that session URL directly. A resumable session URL is already authorised, so no Drive token ever reaches the browser. This gives real progress bars, resume after a dropped connection, and the same path for a 1 MB photo and a 300 MB video.

1. Staff open `/u/{clinic-slug}` and enter the clinic passcode once. Set a signed cookie for 30 days.
2. The patient field calls `GET /api/patients?q=` as they type and shows matches by name or ID. “Add as a new patient” is offered when there is no exact match; the patient row is created at submit, not at pick.
3. Media comes from `<input type="file" accept="image/*,video/*" capture="environment" multiple>`. Photos are compressed client-side with `browser-image-compression` to a 2048 px long edge, JPEG at 0.85, EXIF orientation applied and then all EXIF stripped (GPS included). Videos are not transcoded; cap them at 500 MB and 3 minutes and show the size before upload. Photo labels default to alternating Before and After, videos default to Testimonial; tapping the label cycles Before, After, Testimonial, Other.
4. Submit creates a client-side `upload_id` (UUID) and sends `POST /api/uploads/start` with patient, treatment, date, description, uploaded_by and the consent flags. The server finds or creates the patient folder and the session folder in Drive, writes the Session row with that `upload_id`, and returns the session ID. A retry with the same `upload_id` returns the existing session instead of creating a second one.
5. For each file the browser calls `POST /api/uploads/{sessionId}/sign` with name, MIME type, size and label. The server calls Drive `files.create` with `uploadType=resumable` and the session folder as parent, and returns the `Location` header (the session URI). The browser PUTs the file to that URI in 8 MB chunks with `Content-Range`, continues on 308, and on a network drop queries the URI for the last received byte and resumes. On 200 or 201 it posts the returned Drive file ID to `POST /api/uploads/{sessionId}/media`; the server confirms with `files.get` that the file exists in the session folder before writing the Media row. Files upload one at a time so iOS cannot drop a backgrounded tab mid-batch.
6. `POST /api/uploads/{sessionId}/finish` writes the ConsentEvent row, writes `consent.json` into the session folder when consent was ticked, appends a line to `_consent-log.csv`, sets `Session.status` to `ready` or `hold`, and returns the Drive path for the success screen.
7. Form state lives in React state only. Do not persist it to localStorage; it contains patient names.

The consent sentence is a constant in code with a version number. Changing the wording bumps the version so old ConsentEvents still say exactly what the person agreed to.

## Patient directory

The directory reads from the database, never from Drive, so search is instant. Drive is called only for thumbnails, streams and downloads.

- **Search as you type.** `GET /api/patients?q=` fires after two characters with a 150 ms debounce and must return in under 150 ms with 500 patients seeded: add a `pg_trgm` index on first name, last name, display ID and session treatment. Typing “veneers” lists every patient with a veneers session. Results replace in place with no loading flash, and the list keeps keyboard focus.
- **Two filter rows.** Clearance: All, Cleared for social, Not cleared, Posted. Media: All media, Photos, Videos. They combine with each other and with search. With Videos selected the patient page shows only video tiles.
- **Social clearance is the first thing on a patient page.** A full-width status reads “Cleared for social” (consent on every session and not withdrawn), “Not cleared” with the number of sessions missing consent, or “Consent withdrawn”. The same status is a badge on every list row. It is derived, never set by hand.
- **Detail view** then shows Share (primary), Open in Drive (the folder’s `webViewLink`) and Download all, four counts (sessions, photos, videos, posted), and each session newest first: date and treatment, who uploaded it, a status dropdown (Ready to post / Posted) replaced by a Not cleared badge when no consent exists, before/after pairs matched by order, videos and other media in a strip with a play badge, the description, and a caption draft with a copy button.
- **Thumbnails** use Drive’s `thumbnailLink` with `sz=w800` for photos and videos alike (Drive generates video posters). The link expires, so the API returns it fresh on each load.
- **Video playback** streams through `GET /api/media/{id}/stream`, a signed route that proxies Drive `files.get?alt=media` with Range support so iOS Safari can scrub. Drive sharing settings never change.
- **Download all** streams a zip of the patient’s originals from Drive through a route handler using `archiver`, named `{Last}-{First}-{ID}.zip`. Single files use a signed redirect to the Drive file.
- **Caption draft** is a template: `Before and after: {treatment} at {clinic}. {description} Shared with the patient’s written consent.` A starting point for the social team, not a generated caption.

On phones the list and detail are two stacked screens with a back button, every control at least 44 px tall, and the share and status elements visible without scrolling. On desktop they sit side by side, list at 360 px, detail filling the rest.

## Share by text

Share creates a private, expiring link for one patient and hands it to the phone’s share sheet (`navigator.share`), so it goes out by iMessage or SMS in one tap; on desktop it copies the link. The prototype’s `#share` view is the design.

What the recipient sees at `/s/{token}`: a mobile-first page with his wordmark, the patient as first name and last initial plus ID, only sessions with consent on file (sessions without consent are counted as hidden and never rendered), a before/after slider on each session’s first pair, remaining photos and videos in a strip, testimonial quotes, and Download all. No login, no portal chrome.

Rich preview: the page serves Open Graph and Twitter tags with a generated image (`@vercel/og`) showing his wordmark and “Before and after, {treatment}” in the brand palette, with no patient photo and no name, so the bubble in iMessage looks designed but leaks nothing if the text is forwarded.

Guardrails, none optional:

- The token is 32 random bytes shown once and stored as a hash. Expiry defaults to 7 days with a chooser for 1, 7 or 30 days.
- The patient page lists active links with view count and last viewed, each with Revoke. Withdrawing consent revokes every link for that patient at once.
- An optional 4-digit PIN for sensitive cases, entered once per device.
- Every open is logged as a ShareView. Expired or revoked links show a short branded “This link has expired” page, never an error.
- Video on the share page streams through the same signed route as the portal.

## Access control and compliance

Two doors. The upload page is protected by a clinic passcode (bcrypt hash on the Clinic row, 5 attempts per IP per 15 minutes, rotatable from an admin page) and sets a signed 30-day cookie. The dashboard uses Auth.js with Google sign-in and an allowlist of email addresses; every dashboard and API route checks the session and scopes queries by clinic ID. The only unauthenticated routes are the passcode screen and share pages.

The part to settle before launch: patient photos plus names are protected health information if the clinic is a HIPAA covered entity, and a dental practice almost always is. A signed consent to post lets the clinic publish the photos; it does not make the pipeline that stores them exempt.

- Google Drive is covered under a Workspace Business Associate Agreement, which an admin must turn on. A personal Gmail Drive has no BAA, which is another reason to prefer the Shared Drive option.
- Vercel does not sign a BAA on standard plans. Keep media off Vercel: uploads go browser-to-Drive, streams are proxied without buffering to disk, and request bodies, patient names and file names are never logged.
- Check whether the database provider will sign a BAA on the plan chosen. If not, store only initials plus the display ID in the database and keep the full name in the Drive folder name, where the BAA applies. Search then works on initials and ID. The prototype shows full names; that is the better product and the weaker compliance posture.
- Store nothing else about the patient. No date of birth, phone, email or address anywhere in the app.
- ConsentEvent rows are kept forever and never edited. Add a “Consent withdrawn” action on the patient that blocks further posting, revokes share links, and lists every session already marked Posted so the social team can take them down.

Share links are the one place patient media leaves the login wall. The hashed token, expiry, no-name previews, view log and the consent-withdrawn kill switch are the controls that make that defensible; build them in step 5, not later.

Have the clinic’s compliance person or counsel confirm the setup. This brief is an engineering plan, not legal advice.

## Environment, build order, acceptance

Environment variables, all set in Vercel and mirrored in `.env.example` with placeholder values:

| Variable | What it is |
| --- | --- |
| `APP_URL` | The public origin, e.g. `https://photos.beverlyhillscosmeticdentist.com`, used in share links and OG tags |
| `DATABASE_URL` | Postgres connection string |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Base64 of the service account key (Shared Drive option) |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` | Only for the OAuth option |
| `DRIVE_ROOT_FOLDER_ID` | The “Posting Center” folder or Shared Drive ID |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Auth.js |
| `ALLOWED_EMAILS` | Comma-separated dashboard allowlist |
| `COOKIE_SECRET` | Signs the upload-page cookie |
| `SHARE_SECRET` | Signs stream and download URLs on share pages |
| `MAX_VIDEO_MB` | Upload cap for video, default 500 |
| `CONSENT_TEXT_VERSION` | Integer, bump when the consent sentence changes |

Build in this order, with a working deploy at the end of each step:

1. Repo scaffold, Prisma schema and migration, seed script with the sample patients from the prototype (including the videos), Vercel deploy on the custom subdomain showing the empty dashboard behind Google sign-in, web app manifest and icons.
2. Drive client: find-or-create folder, mint resumable upload session, confirm file in folder, list folder, thumbnail link, signed stream with Range support. Unit-test against a scratch folder.
3. Upload page: passcode, patient picker, photo compression, video size check, direct-to-Drive chunked upload with progress and resume, the four upload routes, success screen with the real Drive path.
4. Patient directory: search as you type with the trigram index, both filter rows, clearance status, detail view with video playback, status dropdown, caption copy.
5. Share by text: share links, share page, OG image, share sheet integration, revoke and view log, expired page, consent-withdrawn kill switch.
6. Download all (zip), Open in Drive, Consent withdrawn action.
7. Admin page: clinic name, passcode rotation, allowlist view. Logging and error reporting with PHI scrubbed.

Acceptance, all on a real phone against a real Drive:

- [ ] A 6-photo upload from an iPhone over cellular completes in under 30 seconds and every file is in `Patients / {Patient} / {date treatment}` with the right label and counter.
- [ ] A 150 MB video uploads from an iPhone with a live progress bar, survives airplane mode toggled on and off mid-upload, and plays back in the portal with scrubbing.
- [ ] Ticking consent produces `consent.json` beside the files and a ConsentEvent row; leaving it unticked produces neither and the patient shows Not cleared.
- [ ] Killing the browser mid-upload and resubmitting does not create a second session or duplicate files.
- [ ] A new patient typed in the picker appears in directory search immediately after submit.
- [ ] With 500 patients seeded, search results update in under 150 ms per keystroke, and “veneers” matches by treatment.
- [ ] The Videos filter lists only patients with video and the patient page shows only video tiles.
- [ ] Share from the patient page opens the iOS share sheet; the link sent by iMessage shows a branded preview with no patient name or photo, opens to the share page with his wordmark and the slider, hides non-consented sessions, and shows the expired page after its expiry or after Revoke.
- [ ] Download all returns a zip whose contents match the Drive folder exactly.
- [ ] No patient name or file name appears in Vercel logs.
- [ ] The dashboard refuses an email not on the allowlist.

## Open decisions

Three calls were made in this brief that the owner may want to overturn. Confirm them before step 1.

1. Uploads without consent still save to Drive and show as Not cleared, rather than being blocked at upload.
2. Full patient names are stored in the database. The alternative is initials plus display ID in the database and the full name only in the Drive folder.
3. The Shared Drive + service account option assumes Google Workspace is available.

## Owner-approved additions, 28 Oct 2026

- Add two libraries: Patients and Other uploads. Other uploads accepts general raw
  footage without a patient record; retain the patient model and consent rules.
- Use the current official Dr. Sands website as the brand source.
- Supporting React/React DOM, TypeScript/Node types, PostCSS/Tailwind plugin and
  Prisma PostgreSQL adapter/pg packages were approved.
- Repository: CoreyOutlier/SandsMedia. Vercel project: sandsmedia-platform under
  Outlier Creative Agency. Test origin: https://sandsmedia-platform.vercel.app.
- The owner subsequently clarified that they do not own the proposed custom
  domain. Use the Vercel origin for testing; no DNS changes are authorized or needed.

### Upload and organization clarification (requirements, not completed features)

- A patient upload accepts one photo, many photos, videos, or a mixed batch of
  photos and videos together. Choose the patient once, preview all selected files,
  add/remove files before submitting, label each file, and save once. Choosing
  another file must append to the selection rather than discard earlier choices.
- The UI presents one batch with per-file progress. Files transfer sequentially
  under the existing iOS/resume rules. A partial failure must remain visible and
  retryable; never display complete success while any selected file is unfinished.
- New patient: create one patient row and one patient folder. Existing patient:
  reuse both and create a dated upload/session beneath that patient. Submitting or
  retrying must never create duplicate patients or overwrite earlier media.
- Patient detail makes Photos and Videos easy to find across all sessions, with
  dates, treatment, notes, uploader, and consent status. Patient identity remains
  name and display ID only; no additional patient contact or demographic fields.
- Other uploads requires a title. Each new submission creates a separate folder
  `Other uploads/{date title – upload ID}` with Photos/Videos children as needed.
  A single random video gets its own titled upload folder. A related mixed batch
  stays together in one titled folder; it does not create one folder per file.
  Reusing a title on a later upload does not overwrite or merge earlier uploads.
- Search Patients by name, display ID, or treatment and combine it with media and
  clearance filters. Search Other uploads by title or description and filter by
  Photos/Videos. General footage remains separate from patient records and cannot
  bypass patient consent requirements.

Additional acceptance tests for these clarified requirements:

- [ ] Select six photos and one video for one patient and save once; all seven
  appear under that patient with correct Photos/Videos placement and one session.
- [ ] Add another batch to the same patient; no second patient folder is created,
  and both batches are visible. Identically named patients remain distinguishable.
- [ ] Retry a failed mixed batch; already completed files are not duplicated, and
  success is shown only after every selected file is confirmed.
- [ ] Upload one general video with a title, then a separate batch with the same
  title; two distinct titled folders remain searchable without overwriting files.
- [ ] Patient Photos/Videos filters work across visits; Other uploads title search
  returns its matching batch and the media-kind filter shows only matching files.

### Owner clarification — private uploads and posting consent (29 October 2026)

Consent controls posting and external sharing, not private storage. Staff can add
photos and videos to a patient whose consent is missing or withdrawn. Private
uploads must not clear a withdrawal, revive share links, or mark the new session
ready to post while withdrawal remains in force. Recording consent for an upload
does not replace the explicit patient-level consent renewal action. Archived
patients still need to be restored before adding media.

## Owner clarification — 29 October 2026: longer videos

Both patient and Other uploads accept videos up to 5 GB (5,120 × 1,024² bytes)
and 2 hours each. This supersedes the original 500 MB / 3-minute limits. Videos
remain unchanged and transfer directly to private Drive storage in resumable
8 MiB chunks. Photos retain their 2048 px JPEG conversion.

## Owner addition — 29 October 2026: patient collections

Staff can independently star patients as Favorites and mark patients as Celebrities.
These markers are shared across the clinic team and default off. Add one Collection
filter with All patients, Favorites and Celebrities, composed with existing search,
consent, media and archive filters. Celebrity records receive a restrained gold
badge and accent in the private directory and detail view. Keep social clearance
visible and unchanged. Neither marker grants permission to post or share, and
neither appears in public shares. Other uploads remains a separate general library.
