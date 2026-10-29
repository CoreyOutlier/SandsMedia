"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION } from "@/lib/consent";
import { MediaGallery } from "./media-gallery";
import { portalApi, withdrawPatient, renewPatientConsent, displayDate, type ArchiveFilter, type Row, type Detail } from "./types";

const statusText = (status: string) => ({ cleared: "Cleared for social", hold: "Not cleared", withdrawn: "Consent withdrawn", private: "Private footage", archived: "Archived" }[status] ?? status);
const historyText = (action: string) => ({ consent_withdrawn: "Consent withdrawn", renewal_recorded: "Renewal record created", consent_renewed: "Written consent renewed", archived: "Patient archived", restored: "Patient restored" }[action] ?? "Consent record added");
function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>; }
function FolderIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg>; }

export function Library({ general = false, initialId = "" }: { general?: boolean; initialId?: string }) {
 const [q, setQ] = useState("");
 const [filter, setFilter] = useState("all");
 const [media, setMedia] = useState("all");
 const [archive, setArchive] = useState<ArchiveFilter>("active");
 const [rows, setRows] = useState<Row[]>([]);
 const [more, setMore] = useState(false);
 const [selected, setSelected] = useState(initialId);
 const [detail, setDetail] = useState<Detail | null>(null);
 const [showDetail, setShowDetail] = useState(!!initialId);
 const [loading, setLoading] = useState(true);
 const [loadingMore, setLoadingMore] = useState(false);
 const [error, setError] = useState("");
 const [notice, setNotice] = useState("");
 const [version, setVersion] = useState(0);
 const searchGeneration = useRef(0);
 const detailGeneration = useRef(0);
 const directoryScroll = useRef(0);
 const [shareOpen, setShareOpen] = useState(false);
 const [days, setDays] = useState(7);
 const [pin, setPin] = useState("");
 const [shareUrl, setShareUrl] = useState("");
 const [shareError, setShareError] = useState("");
 const [busyAction, setBusyAction] = useState("");
 const mutating = !!busyAction;
 const [consentMode, setConsentMode] = useState<"withdraw" | "renew" | null>(null);
 const [consentConfirm, setConsentConfirm] = useState(false);
 const [consentError, setConsentError] = useState("");
 const [consentNotice, setConsentNotice] = useState("");
 const [archiveOpen, setArchiveOpen] = useState(false);
 const [archiveError, setArchiveError] = useState("");
 const [archiveNotice, setArchiveNotice] = useState("");
 const renewalRequest = useRef("");
 const consentPanel = useRef<HTMLElement>(null);
 const [clinicName, setClinicName] = useState("Dr. Sands");
 const [sharingReady, setSharingReady] = useState(false);

 useEffect(() => { portalApi<{ name: string; sharingReady: boolean }>("/api/admin").then(r => { setClinicName(r.name); setSharingReady(r.sharingReady); }).catch(() => {}); }, []);
 useEffect(() => {
  const generation = ++searchGeneration.current;
  const timer = setTimeout(() => {
   setLoading(true);
   portalApi<{ rows: Row[]; more: boolean }>("/api/library", { q, filter, media, general, archive }).then(r => {
    if (generation !== searchGeneration.current) return;
    setRows(r.rows); setMore(r.more); setSelected(old => old || r.rows[0]?.id || ""); setError("");
   }).catch(e => { if (generation === searchGeneration.current) setError(e.message); }).finally(() => { if (generation === searchGeneration.current) setLoading(false); });
  }, q.length ? 150 : 0);
  return () => clearTimeout(timer);
 }, [q, filter, media, general, archive, version]);
 useEffect(() => {
  const generation = ++detailGeneration.current;
  setShareOpen(false); setShareUrl(""); setShareError(""); setConsentMode(null); setConsentConfirm(false); setConsentError(""); setConsentNotice(""); setArchiveOpen(false); setArchiveError(""); setArchiveNotice(""); setDetail(null); renewalRequest.current = "";
  if (!selected) return;
  portalApi<Detail>(`/api/${general ? "general" : "patients"}/${selected}`).then(r => { if (generation === detailGeneration.current) setDetail(r); }).catch(e => { if (generation === detailGeneration.current) setError(e.message); });
 }, [selected, general, version]);
 const refresh = () => setVersion(v => v + 1);
 const updateDetail = (updated: Detail) => {
  setDetail(updated);
  setRows(old => old.map(row => row.id === updated.id ? { ...row, archived: !!updated.archivedAt, status: updated.clearance?.status ?? row.status, posted: updated.sessions.filter(s => s.status === "posted").length } : row).filter(row => (general || archive === "all" || (archive === "archived" ? row.archived : !row.archived)) && (general || filter === "all" || (filter === "cleared" && row.status === "cleared") || (filter === "hold" && row.status !== "cleared") || (filter === "posted" && row.status === "cleared" && (row.posted ?? 0) > 0))));
 };
 async function loadMore() {
  if (loadingMore) return;
  setLoadingMore(true);
  const generation = searchGeneration.current;
  try { const r = await portalApi<{ rows: Row[]; more: boolean }>("/api/library", { q, filter, media, general, archive, offset: rows.length }); if (generation !== searchGeneration.current) return; setRows(old => [...old, ...r.rows]); setMore(r.more); }
  catch (e) { setError((e as Error).message); } finally { setLoadingMore(false); }
 }
 async function changeStatus(sessionId: string, status: string) {
  if (!detail || mutating) return;
  setBusyAction(`status-${sessionId}`); setError("");
  try { updateDetail(await portalApi<Detail>(`/api/patients/${detail.id}`, { action: "status", sessionId, status })); setNotice(status === "posted" ? "Session marked as posted." : "Session is ready to post."); }
  catch (e) { setError((e as Error).message); } finally { setBusyAction(""); }
 }
 function openConsent(mode: "withdraw" | "renew") {
  setConsentMode(mode); setConsentConfirm(false); setConsentError(""); setConsentNotice("");
  if (mode === "renew" && !renewalRequest.current) renewalRequest.current = crypto.randomUUID();
  requestAnimationFrame(() => { consentPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" }); consentPanel.current?.focus({ preventScroll: true }); });
 }
 async function saveConsent() {
  if (!detail || !consentConfirm || !consentMode || mutating) return;
  const mode = consentMode;
  setBusyAction(mode); setConsentError(""); setConsentNotice("");
  try {
   const updated = mode === "withdraw" ? await withdrawPatient(detail.id) : await renewPatientConsent(detail.id, renewalRequest.current);
   updateDetail(updated); setConsentMode(null); setConsentConfirm(false); setShareOpen(false); setShareUrl("");
   if (mode === "renew") renewalRequest.current = "";
   setConsentNotice(mode === "withdraw" ? "Consent withdrawn. Posting and sharing are blocked, and every existing share link is revoked." : "New written consent recorded. Previous consent history is preserved, and old share links remain revoked.");
  } catch (e) { setConsentError((e as Error).message); } finally { setBusyAction(""); }
 }
 async function changeArchive() {
  if (!detail || mutating) return;
  const restoring = !!detail.archivedAt;
  setBusyAction(restoring ? "restore" : "archive"); setArchiveError(""); setArchiveNotice("");
  try {
   const updated = await portalApi<Detail>(`/api/patients/${detail.id}`, { action: restoring ? "restore" : "archive" });
   updateDetail(updated); setArchiveOpen(false); setShareOpen(false); setShareUrl("");
   setArchiveNotice(restoring ? "Patient restored. Consent status is unchanged; previous share links remain revoked." : "Patient archived. Files and consent history are retained. Find this patient using the Archived filter to restore them anytime.");
  } catch (e) { setArchiveError((e as Error).message); } finally { setBusyAction(""); }
 }
 async function createShare() {
  if (!detail || mutating) return;
  setBusyAction("share"); setShareError("");
  try {
   const r = await portalApi<{ url: string }>("/api/shares", { patientId: detail.id, days, pin });
   setShareUrl(r.url); setPin(""); setDetail(await portalApi<Detail>(`/api/patients/${detail.id}`));
   setNotice("Private link created. Copy or send it below. The full link is shown only here.");
  } catch (e) { setShareError((e as Error).message); } finally { setBusyAction(""); }
 }
 async function sendShare() {
  try { if (navigator.share) await navigator.share({ title: "Dr. Sands — Private media", text: "Private media from Dr. Sands. This link expires.", url: shareUrl }); else { await navigator.clipboard.writeText(shareUrl); setNotice("Private link copied."); } }
  catch (e) { if ((e as Error).name !== "AbortError") setNotice("Use Copy link, or select and copy the link below."); }
 }
 async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice("Copied."); } catch { setNotice("Copy is unavailable in this browser. Select the text to copy it."); } }
 async function revoke(id: string) {
  if (mutating) return;
  setBusyAction(`revoke-${id}`); setShareError("");
  try { await portalApi(`/api/shares/${id}`, {}); if (detail) setDetail(await portalApi(`/api/patients/${detail.id}`)); setShareUrl(""); setNotice("Link revoked. It can no longer open media."); }
  catch (e) { setShareError((e as Error).message); } finally { setBusyAction(""); }
 }
 function renameMedia(id: string, title: string | null) { setDetail(old => old ? { ...old, sessions: old.sessions.map(s => ({ ...s, media: s.media.map(m => m.id === id ? { ...m, title } : m) })) } : old); }
 const allMedia = detail?.sessions.flatMap(s => s.media) ?? [];
 const archived = !!detail?.archivedAt;
 const cleared = detail?.clearance?.status === "cleared" && !archived;
 const withdrawn = detail?.clearance?.status === "withdrawn";
 const visibleSessions = detail?.sessions.filter(s => media === "all" || s.media.some(m => m.kind === media)) ?? [];
 const activeLinks = detail?.links.filter(l => !l.revokedAt && new Date(l.expiresAt).getTime() > Date.now()).length ?? 0;

 return <section className={`portal-library library-refined ${showDetail ? "show-detail" : ""}`}>
  <header className="library-topbar"><div><p className="eyebrow">Posting Center / Private library</p><h1>{general ? "Other uploads" : "Patients"}</h1><p className="library-intro">{general ? "Every idea, take, and behind-the-scenes moment." : "Photos, videos, and consent. All in one place."}</p></div><Link className="button primary" href={general ? "/upload?type=general" : "/upload"}>＋ New upload</Link></header>
  <div className={`library-toolbar ${general ? "general-toolbar" : ""}`}>
   <label className="library-search-field"><span className="sr-only">{general ? "Search title or notes" : "Search name, ID or treatment"}</span><SearchIcon /><input id="library-search" type="search" disabled={mutating} autoComplete="off" value={q} onChange={e => setQ(e.target.value)} placeholder={general ? "Search title or notes" : "Search name, ID or treatment"} /></label>
   {!general && <label className="library-select"><span>Consent</span><select disabled={mutating} aria-label="Filter by consent" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Any status</option><option value="cleared">Cleared for social</option><option value="hold">Not cleared</option><option value="posted">Posted</option></select></label>}
   <label className="library-select"><span>Show</span><select disabled={mutating} aria-label="Filter by media type" value={media} onChange={e => setMedia(e.target.value)}><option value="all">All media</option><option value="photo">Photos only</option><option value="video">Videos only</option></select></label>
   {!general && <label className="library-select"><span>Library</span><select disabled={mutating} aria-label="Filter by archive status" value={archive} onChange={e => { setArchive(e.target.value as ArchiveFilter); setSelected(""); }}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All patients</option></select></label>}
  </div>
  <aside className="directory" aria-label={general ? "Upload directory" : "Patient directory"}>
   {error && <p className="upload-error directory-error" role="alert">{error}<button className="button quiet" onClick={refresh}>Try again</button></p>}
   <div className="search-summary" aria-live="polite"><span>{loading && rows.length === 0 ? "Opening library…" : `${rows.length}${more ? "+" : ""} ${general ? (rows.length === 1 && !more ? "upload" : "uploads") : (rows.length === 1 && !more ? "patient" : "patients")}`}</span>{q.length === 1 ? <span>Type one more character</span> : (q || filter !== "all" || media !== "all" || archive !== "active") && <button disabled={mutating} onClick={() => { setQ(""); setFilter("all"); setMedia("all"); setArchive("active"); setSelected(""); }}>Reset filters</button>}</div>
   <ul className="patient-list">{rows.map(r => <li key={r.id}><button disabled={mutating} className={selected === r.id ? "selected" : ""} aria-current={selected === r.id ? "true" : undefined} onClick={() => { directoryScroll.current = window.scrollY; setSelected(r.id); setShowDetail(true); setError(""); setNotice(""); if (window.matchMedia("(max-width:879px)").matches) requestAnimationFrame(() => window.scrollTo({ top: 0 })); }}><span className="patient-avatar" aria-hidden="true">{r.name.split(" ").map(x => x[0]).slice(0, 2).join("")}</span><span className="patient-row-main"><strong>{r.name}</strong><small>{r.displayId} · {r.photos} {r.photos === 1 ? "photo" : "photos"} · {r.videos} {r.videos === 1 ? "video" : "videos"}</small><span className={`clearance-badge ${r.archived ? "archived" : r.status}`}>{r.archived ? "Archived" : statusText(r.status)}</span>{r.incomplete && <small>Upload unfinished</small>}</span><span className="patient-row-arrow" aria-hidden="true">›</span></button></li>)}</ul>
   {!loading && !rows.length && <div className="directory-empty"><strong>{archive === "archived" ? "No archived patients" : q || filter !== "all" || media !== "all" ? "No matches" : "Your library is ready"}</strong><p>{archive === "archived" ? "Archived patients stay safely stored here until you restore them." : q || filter !== "all" || media !== "all" ? "Try a shorter search or adjust a filter." : "Save your first upload to see it here."}</p></div>}
   {more && <button className="button load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "Loading…" : "Load more"}</button>}
   <p className="directory-footnote">Private files. Access limited to your team.</p>
  </aside>
  <div className="patient-detail">
   <button className="button quiet directory-back" onClick={() => { setShowDetail(false); requestAnimationFrame(() => window.scrollTo({ top: directoryScroll.current })); }}>← Back to {general ? "uploads" : "patients"}</button>
   {error && <p className="upload-error" role="alert">{error} <button className="button quiet" onClick={refresh}>Try again</button></p>}
   {notice && <p className="portal-notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></p>}
   {!detail ? <div className="detail-empty"><span className="detail-empty-mark" aria-hidden="true"><FolderIcon /></span><h2>{selected ? "Opening your library…" : general ? "Every clip, in its place." : "Every smile, in one place."}</h2><p>{selected ? "Loading your private photos and videos." : "Choose an item to see its photos, videos, and details."}</p></div> : <>
    <header className="patient-heading"><div><p className="patient-record-id">{detail.displayId}{archived ? " / Archived patient" : general ? " / Private footage" : " / Patient record"}</p><h1>{detail.name}</h1></div></header>
    {!general && <div className={`clearance-banner ${archived ? "archived" : detail.clearance?.status}`}><div><strong>{archived ? "Patient archived" : statusText(detail.clearance?.status ?? "hold")}</strong><p>{archived ? "Files and consent history are safely retained. Restore this patient to add media or share again." : cleared ? "Written consent is on file. Ready to post and share." : withdrawn ? "Sharing and posting are paused. Record new written consent when the patient agrees again." : detail.sessions.length === 0 ? "Add photos or videos to create this patient’s first session." : `${detail.clearance?.missing ?? 0} sessions need consent or upload completion before posting and sharing.`}</p></div>{archived ? <button className="button" disabled={mutating} onClick={changeArchive}>{busyAction === "restore" ? "Restoring…" : "Restore patient"}</button> : withdrawn && detail.sessions.some(s => s.finished) && <button className="button" disabled={mutating} onClick={() => openConsent("renew")}>Record new consent</button>}</div>}
    <div className="detail-actions"><a className="button primary" href={detail.download} download>↓ Download all</a>{!general && <button className="button" disabled={!cleared || !sharingReady || mutating} onClick={() => setShareOpen(!shareOpen)} aria-expanded={shareOpen}>Share by text</button>}{detail.driveUrl && <a className="button quiet" href={detail.driveUrl} target="_blank" rel="noreferrer"><FolderIcon />Open in Drive ↗</a>}{!archived && !withdrawn && <Link className="button quiet add-media-link" href={general ? "/upload?type=general" : `/upload?patient=${detail.id}`}>＋ Add media</Link>}</div>
    {!general && cleared && !sharingReady && <p className="upload-notice">Private sharing is waiting for its secure connection to be enabled. Your files remain private.</p>}
    {archiveError && !archiveOpen && <p className="upload-error" role="alert">{archiveError}</p>}
    {shareOpen && <section className="share-controls"><div className="section-title"><h2>A private link, ready to send.</h2><button className="button quiet" onClick={() => setShareOpen(false)}>Close</button></div><div className="upload-columns"><label>Expires after<select value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 7, 30].map(d => <option value={d} key={d}>{d} {d === 1 ? "day" : "days"}</option>)}</select></label><label>Optional 4-digit PIN<input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" type="password" autoComplete="new-password" maxLength={4} /></label></div><p>Only cleared sessions are included. Anyone with the link and any PIN can open it until it expires or is revoked.</p>{shareError && <p className="upload-error" role="alert">{shareError}</p>}<button className="button primary" onClick={createShare} disabled={mutating || (pin.length !== 0 && pin.length !== 4)}>{busyAction === "share" ? "Creating link…" : "Create private link"}</button>{shareUrl && <div className="created-link"><label>Private link<input readOnly value={shareUrl} onFocus={e => e.target.select()} /></label><div className="detail-actions"><button className="button primary" onClick={sendShare}>Send by text / Share</button><button className="button" onClick={() => copy(shareUrl)}>Copy link</button><a className="button" href={shareUrl} target="_blank" rel="noreferrer">Preview</a></div></div>}</section>}
    <div className="media-counts"><div><strong>{allMedia.filter(m => m.kind === "photo").length}</strong><span>{allMedia.filter(m => m.kind === "photo").length === 1 ? "photo" : "photos"}</span></div><div><strong>{allMedia.filter(m => m.kind === "video").length}</strong><span>{allMedia.filter(m => m.kind === "video").length === 1 ? "video" : "videos"}</span></div><div><strong>{detail.sessions.length}</strong><span>{detail.sessions.length === 1 ? "session" : "sessions"}</span></div>{!general && <div><strong>{detail.sessions.filter(s => s.status === "posted").length}</strong><span>posted</span></div>}</div>
    <div className="collection-heading"><h2>{media === "photo" ? "Photos" : media === "video" ? "Videos" : "Photos & videos"}</h2><span>Newest sessions first</span></div>
    {!visibleSessions.length && <p className="empty-media">No {media === "video" ? "videos" : media === "photo" ? "photos" : "files"} match the current view.</p>}
    {visibleSessions.map(s => <section className="visit" key={s.id}><div className="visit-heading"><div><p className="visit-date">{displayDate(s.date)}</p><h2>{s.title}</h2><p>{s.uploadedBy ? `Uploaded by ${s.uploadedBy}` : "Private upload"}{!s.finished ? " · Upload unfinished" : s.consented ? " · Consent recorded" : ""}</p></div>{!general && (cleared && s.consented ? <label className="session-status"><span className="sr-only">Posting status for {s.title}</span><select disabled={mutating} value={s.status} onChange={e => changeStatus(s.id, e.target.value)}><option value="ready">Ready to post</option><option value="posted">Posted</option></select>{busyAction === `status-${s.id}` && <small role="status">Saving…</small>}</label> : <span className="clearance-badge hold">{s.status === "posted" ? "Posted — review required" : archived ? "Archived" : "Not cleared"}</span>)}</div>
     {(s.photosDriveUrl || s.videosDriveUrl || s.driveUrl) && <div className="visit-storage"><span><FolderIcon />Drive folders</span>{s.photosDriveUrl && <a href={s.photosDriveUrl} target="_blank" rel="noreferrer">Photos ↗</a>}{s.videosDriveUrl && <a href={s.videosDriveUrl} target="_blank" rel="noreferrer">Videos ↗</a>}{!s.photosDriveUrl && !s.videosDriveUrl && s.driveUrl && <a href={s.driveUrl} target="_blank" rel="noreferrer">Open session ↗</a>}</div>}
     <MediaGallery media={s.media} filter={media} pairs={!general} editable={!archived && !!s.finished} general={general} onRenamed={renameMedia} />
     {s.quote && <blockquote className="testimonial">“{s.quote}”</blockquote>}{s.description && <p className="visit-notes">{s.description}</p>}{!general && cleared && <details className="caption-details"><summary>Caption draft</summary><div className="caption-draft"><p>Before and after: {s.title} at {clinicName}. {s.description} Shared with the patient’s written consent.</p><button className="button quiet" onClick={() => copy(`Before and after: ${s.title} at ${clinicName}. ${s.description ?? ""} Shared with the patient’s written consent.`)}>Copy caption</button></div></details>}
    </section>)}
    {!general && <>
     <details className="share-history library-disclosure"><summary><span>Shared links</span><span>{activeLinks ? `${activeLinks} active` : "No active links"}</span></summary><div className="disclosure-body">{!detail.links.length && <p>No links created yet.</p>}{!shareOpen && shareError && <p className="upload-error" role="alert">{shareError}</p>}{detail.links.map(l => <div className="share-history-row" key={l.id}><div><strong>{l.revokedAt ? "Revoked" : new Date(l.expiresAt).getTime() <= Date.now() ? "Expired" : "Active"}{l.pinProtected ? " · PIN protected" : ""}</strong><p>Expires {displayDate(l.expiresAt)} · {l.viewCount} views{l.lastViewedAt ? ` · Last opened ${new Date(l.lastViewedAt).toLocaleString()}` : ""}</p>{l.views.length > 0 && <details><summary>Recent views</summary><ul>{l.views.map(v => <li key={v.id}>{new Date(v.createdAt).toLocaleString()}</li>)}</ul></details>}</div>{!l.revokedAt && new Date(l.expiresAt).getTime() > Date.now() && <button className="button" disabled={mutating} onClick={() => revoke(l.id)}>{busyAction === `revoke-${l.id}` ? "Revoking…" : "Revoke"}</button>}</div>)}</div></details>
     <section className="patient-management" ref={consentPanel} tabIndex={-1}><div className="section-title"><h2>Consent & patient settings</h2></div>
      <div className="patient-setting-row"><div><h3>Written consent</h3><p>{withdrawn ? "A patient can give new written consent at any time. Every change stays in their history." : "Control whether this patient’s media can be posted or shared. Existing records are always retained."}</p></div><div className="setting-actions">{withdrawn && !archived && detail.sessions.some(s => s.finished) && <button className="button" disabled={mutating} onClick={() => openConsent("renew")}>Record new consent</button>}{!withdrawn && !archived && <button className="button quiet danger-text" disabled={mutating} onClick={() => openConsent("withdraw")}>Withdraw consent</button>}</div></div>
      {consentMode && <div className={`consent-action-panel ${consentMode}`}><h3>{consentMode === "renew" ? "Record new written consent" : "Withdraw consent"}</h3><p>{consentMode === "renew" ? "Confirm that the patient’s new signed consent covers every completed session currently in this record. A new entry will be added to the consent history. Old share links stay revoked." : "Posting and sharing will stop immediately, and all share links will be revoked. Review any already-posted sessions for removal."}</p><label className="consent-choice"><input type="checkbox" checked={consentConfirm} disabled={mutating} onChange={e => setConsentConfirm(e.target.checked)} /><span>{consentMode === "renew" ? CONSENT_TEXT : "The practice has confirmed withdrawal of this patient’s consent."}{consentMode === "renew" && <small>I confirm a signed form covering all completed sessions is on file.</small>}</span></label>{consentMode === "renew" && <p className="consent-version">Consent text version {CONSENT_TEXT_VERSION}</p>}{consentError && <p className="upload-error" role="alert">{consentError}</p>}<div className="consent-action-buttons"><button className={`button ${consentMode === "withdraw" ? "danger" : "primary"}`} disabled={!consentConfirm || mutating} onClick={saveConsent}>{busyAction === "renew" ? "Recording consent…" : busyAction === "withdraw" ? "Withdrawing consent…" : consentMode === "renew" ? "Record new consent" : "Confirm withdrawal"}</button><button className="button quiet" disabled={mutating} onClick={() => { setConsentMode(null); setConsentConfirm(false); }}>Cancel</button></div>{(busyAction === "renew" || busyAction === "withdraw") && <p role="status">{busyAction === "renew" ? "Recording renewed consent and updating private storage…" : "Recording the withdrawal and revoking shared links…"} Keep this page open.</p>}</div>}
      {consentNotice && <p className="action-success" role="status">{consentNotice}</p>}
      {(detail.consentHistory?.length ?? 0) > 0 && <details className="consent-history"><summary>View consent & archive history</summary><ol>{detail.consentHistory.map(event => <li key={event.id}><strong>{historyText(event.action)}</strong><span>{new Date(event.createdAt).toLocaleString()}{event.actor ? ` · ${event.actor}` : ""}</span></li>)}</ol></details>}
      {detail.postedSessions.length > 0 && withdrawn && <div className="posted-review"><h3>Review these posted sessions</h3><p>Remove previously published media wherever the patient’s consent has been withdrawn.</p><ul>{detail.postedSessions.map(s => <li key={s.id}>{displayDate(s.date)} · {s.title}</li>)}</ul></div>}
      <div className="patient-setting-row archive-setting"><div><h3>{archived ? "Restore this patient" : "Archive this patient"}</h3><p>{archived ? "Return the patient to the active library. Their consent status stays unchanged." : "Keep the library tidy without losing photos, videos, or consent history. You can restore the patient later."}</p></div><button className="button quiet" disabled={mutating} onClick={() => archived ? changeArchive() : setArchiveOpen(!archiveOpen)}>{busyAction === "restore" ? "Restoring…" : archived ? "Restore patient" : "Archive patient"}</button></div>
      {archiveOpen && <div className="archive-confirm"><p>This patient will move to Archived. Sharing and posting will be blocked, and existing share links revoked. Their private files stay safely stored.</p>{archiveError && <p className="upload-error" role="alert">{archiveError}</p>}<div className="consent-action-buttons"><button className="button" disabled={mutating} onClick={changeArchive}>{busyAction === "archive" ? "Archiving…" : "Confirm archive"}</button><button className="button quiet" disabled={mutating} onClick={() => setArchiveOpen(false)}>Cancel</button></div></div>}
      {archiveNotice && <p className="action-success" role="status">{archiveNotice}</p>}
     </section>
    </>}
   </>}
  </div>
 </section>;
}
