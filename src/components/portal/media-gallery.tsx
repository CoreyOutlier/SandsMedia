"use client";
import { useEffect, useRef, useState } from "react";
import { portalApi, PortalRequestError, type MediaItem } from "./types";
import { fileSize, mediaDuration } from "@/lib/media-format";
import { ANONYMOUS_USE_TEXT } from "@/lib/anonymous-use";

function DownloadIcon() {
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" /></svg>;
}
const mediaName = (item: MediaItem) => item.title || `${item.label.charAt(0).toUpperCase()}${item.label.slice(1)} ${item.kind}`;

function MediaCard({ item, onOpen, editable, general, disabled, onRenamed, onDelete, onAnonymousUse }: { item: MediaItem; onOpen: () => void; editable: boolean; general: boolean; disabled: boolean; onRenamed?: (id: string, title: string | null) => void; onDelete?: (item: MediaItem) => Promise<void>; onAnonymousUse?: (item: MediaItem, approved: boolean, requestId: string, reviewToken?: string) => Promise<void> }) {
 const [editing, setEditing] = useState(false);
 const [title, setTitle] = useState(item.title ?? "");
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [saved, setSaved] = useState(false);
 const [deleteOpen, setDeleteOpen] = useState(false);
 const [deleting, setDeleting] = useState(false);
 const [deleteError, setDeleteError] = useState("");
 const [deletePending, setDeletePending] = useState(false);
 const deletePanel = useRef<HTMLDivElement>(null);
 const deleteTrigger = useRef<HTMLButtonElement>(null);
 const [anonymousOpen, setAnonymousOpen] = useState(false);
 const [anonymousConfirm, setAnonymousConfirm] = useState(false);
 const [anonymousError, setAnonymousError] = useState("");
 const [anonymousSaving, setAnonymousSaving] = useState(false);
 const [anonymousSaved, setAnonymousSaved] = useState("");
 const [anonymousApproving, setAnonymousApproving] = useState(true);
 const [reviewToken, setReviewToken] = useState("");
 const [reviewPreview, setReviewPreview] = useState("");
 const [reviewLoading, setReviewLoading] = useState(false);
 const [reviewLoaded, setReviewLoaded] = useState(false);
 const [reviewError, setReviewError] = useState("");
 const reviewGeneration = useRef(0);
 const reviewPreviewCurrent = useRef("");
 const anonymousRequest = useRef("");
 const anonymousPanel = useRef<HTMLDivElement>(null);
 const anonymousTrigger = useRef<HTMLButtonElement>(null);
 const [previewAttempt, setPreviewAttempt] = useState(0);
 const [previewUnavailable, setPreviewUnavailable] = useState(false);
 useEffect(() => { setPreviewAttempt(0); setPreviewUnavailable(false); }, [item.thumbnail]);
 useEffect(() => { if (deleteOpen) deletePanel.current?.focus({ preventScroll: true }); }, [deleteOpen]);
 useEffect(() => { if (anonymousOpen) anonymousPanel.current?.focus({ preventScroll: true }); }, [anonymousOpen]);
 useEffect(() => {
  if (!anonymousOpen || !reviewToken) return;
  const timer = setTimeout(() => { setReviewToken(""); setReviewLoaded(false); setAnonymousConfirm(false); setReviewError("This review expired. Refresh the preview and review the photo again."); }, 5 * 60 * 1000);
  return () => clearTimeout(timer);
 }, [anonymousOpen, reviewToken]);
 const reviewReady = !!onAnonymousUse && !!item.anonymousUse?.canApprove && (!anonymousApproving || (!!reviewToken && reviewLoaded && !reviewLoading));
 async function loadAnonymousReview() {
  const generation = ++reviewGeneration.current;
  setReviewToken(""); setReviewPreview(""); reviewPreviewCurrent.current = ""; setReviewLoaded(false); setReviewLoading(true); setReviewError(""); setAnonymousConfirm(false); setAnonymousError("");
  anonymousRequest.current = crypto.randomUUID();
  try {
   const review = await portalApi<{ reviewToken: string; preview: string }>(`/api/media/${item.id}/anonymous-use`, undefined, 60000);
   if (generation !== reviewGeneration.current) return;
   if (!review.reviewToken || !review.preview) throw new Error("The review preview could not load. Refresh the preview to try again.");
   reviewPreviewCurrent.current = review.preview; setReviewPreview(review.preview); setReviewToken(review.reviewToken);
  } catch (e) { if (generation === reviewGeneration.current) setReviewError((e as Error).message); }
  finally { if (generation === reviewGeneration.current) setReviewLoading(false); }
 }
 function closeAnonymousReview() {
  ++reviewGeneration.current; reviewPreviewCurrent.current = "";
  setAnonymousOpen(false); setAnonymousConfirm(false); setReviewToken(""); setReviewPreview(""); setReviewLoaded(false); setReviewLoading(false);
  anonymousTrigger.current?.focus({ preventScroll: true });
 }
 async function saveAnonymousUse() {
  if (!onAnonymousUse || !anonymousConfirm || !reviewReady || anonymousSaving || disabled) return;
  setAnonymousSaving(true); setAnonymousError("");
  try {
   const approved = anonymousApproving;
   await onAnonymousUse(item, approved, anonymousRequest.current, approved ? reviewToken : undefined);
   closeAnonymousReview(); anonymousRequest.current = "";
   setAnonymousSaved(approved ? "Anonymous-use approval saved for this photo." : "Anonymous-use approval removed.");
   anonymousTrigger.current?.focus({ preventScroll: true });
  } catch (e) {
   if (e instanceof PortalRequestError && ["ANONYMOUS_REVIEW_REQUIRED", "ANONYMOUS_REVIEW_STALE", "ANONYMOUS_PHOTO_UNAVAILABLE"].includes(e.code ?? "")) {
    setReviewToken(""); setReviewLoaded(false); setAnonymousConfirm(false); setReviewError(e.message); setAnonymousError("");
   } else setAnonymousError((e as Error).message);
  } finally { setAnonymousSaving(false); }
 }
 function openAnonymousUse() {
  if (anonymousOpen) { closeAnonymousReview(); return; }
  const approving = !item.anonymousUse?.approved;
  setAnonymousApproving(approving); setAnonymousOpen(true); setAnonymousConfirm(false); setAnonymousError(""); setAnonymousSaved(""); setReviewError(""); setDeleteOpen(false); setEditing(false);
  anonymousRequest.current = crypto.randomUUID();
  if (approving) void loadAnonymousReview();
 }
 async function saveTitle() {
  if (busy || disabled || !title.trim()) return;
  setBusy(true); setError(""); setSaved(false);
  try {
   const updated = await portalApi<{ title: string | null }>(`/api/media/${item.id}/title`, { title: title.trim(), general });
   onRenamed?.(item.id, updated.title); setEditing(false); setSaved(true);
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 async function confirmDelete() {
  if (!onDelete || busy || deleting || disabled) return;
  setDeleting(true); setDeleteError("");
  try { await onDelete(item); }
  catch (e) { setDeleteError((e as Error).message); if (e instanceof PortalRequestError && e.code === "DELETION_PENDING") setDeletePending(true); }
  finally { setDeleting(false); }
 }
 function cancelDelete() { setDeleteOpen(false); setDeleteError(""); deleteTrigger.current?.focus({ preventScroll: true }); }
 return <article className="media-card">
  {deletePending ? <div className="media-deletion-placeholder"><span aria-hidden="true">✓</span><strong>Removed from portal</strong><small>Finish moving this file to Drive Trash below.</small></div> : <button type="button" className="gallery-tile" onClick={onOpen} disabled={deleting} aria-label={`Open ${mediaName(item)}`}>
   {previewUnavailable ? <span className="media-preview-unavailable"><span>{item.kind === "video" ? "▶" : "↗"}</span>Open {item.kind}<small>Preview unavailable. Your saved file is unchanged.</small></span> : <img src={item.thumbnail + (previewAttempt ? `${item.thumbnail.includes("?") ? "&" : "?"}previewRetry=1` : "")} alt={mediaName(item)} loading="lazy" onError={() => { if (previewAttempt === 0) setPreviewAttempt(1); else setPreviewUnavailable(true); }} />}
   <span className="gallery-label">{item.label}{item.kind === "video" ? " video" : ""}</span>
   {item.kind === "video" && <span className="video-play" aria-hidden="true">▶</span>}
  </button>}
  <div className="media-card-body">
   <div className="media-card-caption"><strong>{mediaName(item)}</strong><span>{fileSize(item.bytes)}{item.kind === "video" && item.durationS ? ` · ${mediaDuration(item.durationS)}` : ""}</span></div>
   {!general && item.kind === "photo" && item.anonymousUse?.approved && onDelete && !deletePending && <span className="anonymous-use-badge">Anonymous online use approved</span>}
   <div className="media-card-actions">{!deletePending && <a className="media-download" href={item.download} download><DownloadIcon /><span>Download {onDelete ? "original " : ""}{item.kind}</span></a>}{editable && !deletePending && item.kind === "video" && <button className="media-name-action" disabled={busy || disabled} onClick={() => { setEditing(!editing); setDeleteOpen(false); setTitle(item.title ?? ""); setError(""); setSaved(false); }} aria-expanded={editing} aria-label={`${item.title ? "Edit" : "Add"} video title`}>{item.title ? "Edit title" : "Name video"}</button>}{onDelete && <button ref={deleteTrigger} className="media-delete-action" disabled={busy || disabled} aria-expanded={deleteOpen} aria-controls={`delete-media-${item.id}`} onClick={() => { setDeleteOpen(!deleteOpen); setDeleteError(""); setEditing(false); setAnonymousOpen(false); setSaved(false); }}>{deletePending ? "Finish deletion" : `Delete ${item.kind}`}</button>}</div>
   {!general && item.anonymousUse?.approved && item.anonymousDownload && !deletePending && <a className="media-anonymous-download" href={item.anonymousDownload} download><DownloadIcon/>Download for anonymous use</a>}
   {!general && item.kind === "photo" && item.anonymousUse?.canApprove && onAnonymousUse && !deletePending && <button ref={anonymousTrigger} className="media-anonymous-action" disabled={busy || disabled || anonymousSaving} aria-expanded={anonymousOpen} aria-controls={`anonymous-review-${item.id}`} onClick={openAnonymousUse}>{item.anonymousUse?.approved ? "Remove anonymous approval" : "Approve anonymous use"}</button>}
   {anonymousOpen && <div className="anonymous-review-panel" id={`anonymous-review-${item.id}`} ref={anonymousPanel} tabIndex={-1} role="group" aria-labelledby={`anonymous-review-title-${item.id}`}>
    <h3 id={`anonymous-review-title-${item.id}`}>{anonymousApproving ? "Review this photo for anonymous use" : "Remove anonymous-use approval?"}</h3>
    <p>{anonymousApproving ? "Review the entire photo below. Approval applies only to this exact version. It permits use without patient identity; it does not record written patient consent." : "This photo will no longer be available through anonymous share links. Files already downloaded cannot be recalled. Written consent, if recorded, stays separate."}</p>
    {anonymousApproving && <div className="anonymous-exact-review">
     {(reviewLoading || (reviewPreview && !reviewLoaded && !reviewError)) && <p role="status">Loading the full photo for review…</p>}
     {reviewPreview && <img key={reviewPreview} src={reviewPreview} alt="Exact photo being reviewed for anonymous use" onLoad={() => { if (reviewPreviewCurrent.current === reviewPreview) setReviewLoaded(true); }} onError={() => { if (reviewPreviewCurrent.current === reviewPreview) { setReviewLoaded(false); setReviewToken(""); setAnonymousConfirm(false); setReviewError("The review photo could not load. Refresh the preview before approving it."); } }}/>}
     {reviewLoaded && reviewToken && <a href={reviewPreview} className="anonymous-photo-review-link" target="_blank" rel="noreferrer">Open full-size review ↗</a>}
     {reviewError && <p className="upload-error" role="alert">{reviewError}</p>}
     <button type="button" className="button quiet" disabled={disabled || anonymousSaving || reviewLoading} onClick={() => void loadAnonymousReview()}>{reviewLoading ? "Loading preview…" : "Refresh preview"}</button>
     <p className="anonymous-review-expiry">Review expires after five minutes. Refresh if the photo changes.</p>
    </div>}
    <label className="consent-choice"><input type="checkbox" checked={anonymousConfirm} disabled={disabled || anonymousSaving || !reviewReady} onChange={e => setAnonymousConfirm(e.target.checked)}/><span>{anonymousApproving ? ANONYMOUS_USE_TEXT : "Remove anonymous online-use approval for this photo."}</span></label>
    {anonymousError && <p className="upload-error" role="alert">{anonymousError}</p>}
    <div className="anonymous-review-buttons"><button className="button primary" disabled={!anonymousConfirm || !reviewReady || disabled || anonymousSaving} onClick={saveAnonymousUse}>{anonymousSaving ? "Saving…" : anonymousApproving ? "Approve this photo" : "Remove approval"}</button><button className="button quiet" disabled={disabled || anonymousSaving} onClick={closeAnonymousReview}>Cancel</button></div>
   </div>}
   {anonymousSaved && <p className="media-saved" role="status">{anonymousSaved}</p>}
   {editing && <form className="media-title-editor" onSubmit={e => { e.preventDefault(); void saveTitle(); }}><label htmlFor={`title-${item.id}`}>Video title</label><input id={`title-${item.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} disabled={busy || disabled} autoFocus placeholder="e.g. Smile reveal" required /><div className="media-title-actions"><button className="button primary" disabled={busy || disabled || !title.trim()}>{busy ? "Saving…" : "Save title"}</button><button className="button quiet" type="button" onClick={() => setEditing(false)} disabled={busy || disabled}>Cancel</button></div>{error && <p className="upload-error" role="alert">{error}</p>}</form>}
   {deleteOpen && <div className="media-delete-confirm" id={`delete-media-${item.id}`} ref={deletePanel} tabIndex={-1} role="group" aria-labelledby={`delete-media-title-${item.id}`}><h3 id={`delete-media-title-${item.id}`}>{deletePending ? "Finish deleting this file" : `Delete this ${item.kind}?`}</h3><p>{deletePending ? "This file is no longer accessible through the portal. Retry to finish moving it to private Drive Trash." : `The ${item.label} ${item.kind} shown above will leave the portal and move to your private Drive Trash.`}</p><p>{general ? "Other files in this upload stay unchanged." : "It will no longer appear in shared pages. Consent history is kept."}</p>{deleteError && <p className="upload-error" role="alert">{deleteError}</p>}<div className="media-delete-buttons"><button className="button danger" disabled={busy || disabled || deleting} onClick={confirmDelete}>{deleting ? "Deleting…" : deleteError || deletePending ? "Retry deletion" : `Delete ${item.kind}`}</button><button className="button quiet" disabled={deleting || disabled} onClick={cancelDelete}>{deletePending ? "Close" : "Cancel"}</button></div>{deleting && <p className="deletion-progress" role="status">Removing access and moving the file to Trash. Keep this page open.</p>}</div>}
   {saved && <p className="media-saved" role="status">Video title saved.</p>}
  </div>
 </article>;
}

export function MediaGallery({ media, filter = "all", pairs = true, editable = false, general = false, disabled = false, onRenamed, onDelete, onAnonymousUse }: { media: MediaItem[]; filter?: string; pairs?: boolean; editable?: boolean; general?: boolean; disabled?: boolean; onRenamed?: (id: string, title: string | null) => void; onDelete?: (item: MediaItem) => Promise<void>; onAnonymousUse?: (item: MediaItem, approved: boolean, requestId: string, reviewToken?: string) => Promise<void> }) {
 const [openId, setOpenId] = useState<string | null>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 const open = media.find(m => m.id === openId) ?? null;
 useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
 const collectionKey = media.map(m => m.id).join(",");
 useEffect(() => { setOpenId(null); }, [filter, collectionKey]);
 const shown = media.filter(m => filter === "all" || m.kind === filter);
 const before = pairs ? shown.filter(m => m.kind === "photo" && m.label === "before") : [];
 const after = pairs ? shown.filter(m => m.kind === "photo" && m.label === "after") : [];
 const extras = pairs ? shown.filter(m => m.kind !== "photo" || !["before", "after"].includes(m.label)) : shown;
 const tile = (m: MediaItem | undefined, label: string) => m ? <MediaCard key={m.id} item={m} onOpen={() => setOpenId(m.id)} editable={editable} general={general} disabled={disabled} onRenamed={onRenamed} onDelete={onDelete} onAnonymousUse={onAnonymousUse} /> : <div className="gallery-missing">No {label} photo in this session</div>;
 return <>
  {Array.from({ length: Math.max(before.length, after.length) }, (_, i) => <div className="media-pair" key={i}>{tile(before[i], "before")}{tile(after[i], "after")}</div>)}
  {extras.length > 0 && <div className="media-strip">{extras.map(m => tile(m, m.label))}</div>}
  {!shown.length && <p className="empty-media">No {filter === "all" ? "media" : filter === "video" ? "videos" : "photos"} in this session.</p>}
  <dialog ref={dialog} className="media-dialog" aria-label={open ? mediaName(open) : "Media preview"} onClose={() => setOpenId(null)} onCancel={() => setOpenId(null)}>
   <div className="media-dialog-actions"><span>{open ? mediaName(open) : "Media preview"}</span><button className="button" onClick={() => setOpenId(null)} aria-label="Close media">Close ×</button></div>
   {open && (open.kind === "video" ? <video key={open.id} src={open.stream} poster={open.thumbnail} controls playsInline preload="metadata" /> : <img src={open.stream} alt={mediaName(open)} />)}
   {open && <a className="button primary" href={open.download} download><DownloadIcon />Download original {open.kind}</a>}
   {open?.anonymousUse?.approved && open.anonymousDownload && onDelete && <a className="button anonymous-modal-download" href={open.anonymousDownload} download><DownloadIcon/>Download for anonymous use</a>}
  </dialog>
 </>;
}
export function Comparison({ before, after }: { before: MediaItem; after: MediaItem }) { const [cut, setCut] = useState(50); return <div className="comparison"><img src={before.thumbnail} alt="Before treatment" /><img src={after.thumbnail} alt="After treatment" style={{ clipPath: `inset(0 0 0 ${cut}%)` }} /><div className="comparison-divider" style={{ left: `${cut}%` }}>↔</div><span className="compare-before">Before</span><span className="compare-after">After</span><input type="range" min={2} max={98} value={cut} onChange={e => setCut(Number(e.target.value))} aria-label="Compare before and after" /></div>; }
