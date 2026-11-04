"use client";
import { useEffect, useRef, useState } from "react";
import { portalApi, PortalRequestError, type MediaItem } from "./types";
import { fileSize, mediaDuration } from "@/lib/media-format";

function DownloadIcon() {
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" /></svg>;
}
const mediaName = (item: MediaItem) => item.title || `${item.label.charAt(0).toUpperCase()}${item.label.slice(1)} ${item.kind}`;

function MediaCard({ item, onOpen, editable, general, disabled, onRenamed, onDelete }: { item: MediaItem; onOpen: () => void; editable: boolean; general: boolean; disabled: boolean; onRenamed?: (id: string, title: string | null) => void; onDelete?: (item: MediaItem) => Promise<void> }) {
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
 const [previewAttempt, setPreviewAttempt] = useState(0);
 const [previewUnavailable, setPreviewUnavailable] = useState(false);
 useEffect(() => { setPreviewAttempt(0); setPreviewUnavailable(false); }, [item.thumbnail]);
 useEffect(() => { if (deleteOpen) deletePanel.current?.focus({ preventScroll: true }); }, [deleteOpen]);
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
   <div className="media-card-actions">{!deletePending && <a className="media-download" href={item.download} download><DownloadIcon /><span>Download {item.kind}</span></a>}{editable && !deletePending && item.kind === "video" && <button className="media-name-action" disabled={busy || disabled} onClick={() => { setEditing(!editing); setDeleteOpen(false); setTitle(item.title ?? ""); setError(""); setSaved(false); }} aria-expanded={editing} aria-label={`${item.title ? "Edit" : "Add"} video title`}>{item.title ? "Edit title" : "Name video"}</button>}{onDelete && <button ref={deleteTrigger} className="media-delete-action" disabled={busy || disabled} aria-expanded={deleteOpen} aria-controls={`delete-media-${item.id}`} onClick={() => { setDeleteOpen(!deleteOpen); setDeleteError(""); setEditing(false); setSaved(false); }}>{deletePending ? "Finish deletion" : `Delete ${item.kind}`}</button>}</div>
   {editing && <form className="media-title-editor" onSubmit={e => { e.preventDefault(); void saveTitle(); }}><label htmlFor={`title-${item.id}`}>Video title</label><input id={`title-${item.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} disabled={busy || disabled} autoFocus placeholder="e.g. Smile reveal" required /><div className="media-title-actions"><button className="button primary" disabled={busy || disabled || !title.trim()}>{busy ? "Saving…" : "Save title"}</button><button className="button quiet" type="button" onClick={() => setEditing(false)} disabled={busy || disabled}>Cancel</button></div>{error && <p className="upload-error" role="alert">{error}</p>}</form>}
   {deleteOpen && <div className="media-delete-confirm" id={`delete-media-${item.id}`} ref={deletePanel} tabIndex={-1} role="group" aria-labelledby={`delete-media-title-${item.id}`}><h3 id={`delete-media-title-${item.id}`}>{deletePending ? "Finish deleting this file" : `Delete this ${item.kind}?`}</h3><p>{deletePending ? "This file is no longer accessible through the portal. Retry to finish moving it to private Drive Trash." : `The ${item.label} ${item.kind} shown above will leave the portal and move to your private Drive Trash.`}</p><p>{general ? "Other files in this upload stay unchanged." : "It will no longer appear in shared pages. Consent history is kept."}</p>{deleteError && <p className="upload-error" role="alert">{deleteError}</p>}<div className="media-delete-buttons"><button className="button danger" disabled={busy || disabled || deleting} onClick={confirmDelete}>{deleting ? "Deleting…" : deleteError || deletePending ? "Retry deletion" : `Delete ${item.kind}`}</button><button className="button quiet" disabled={deleting || disabled} onClick={cancelDelete}>{deletePending ? "Close" : "Cancel"}</button></div>{deleting && <p className="deletion-progress" role="status">Removing access and moving the file to Trash. Keep this page open.</p>}</div>}
   {saved && <p className="media-saved" role="status">Video title saved.</p>}
  </div>
 </article>;
}

export function MediaGallery({ media, filter = "all", pairs = true, editable = false, general = false, disabled = false, onRenamed, onDelete }: { media: MediaItem[]; filter?: string; pairs?: boolean; editable?: boolean; general?: boolean; disabled?: boolean; onRenamed?: (id: string, title: string | null) => void; onDelete?: (item: MediaItem) => Promise<void> }) {
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
 const tile = (m: MediaItem | undefined, label: string) => m ? <MediaCard key={m.id} item={m} onOpen={() => setOpenId(m.id)} editable={editable} general={general} disabled={disabled} onRenamed={onRenamed} onDelete={onDelete} /> : <div className="gallery-missing">No {label} photo in this session</div>;
 return <>
  {Array.from({ length: Math.max(before.length, after.length) }, (_, i) => <div className="media-pair" key={i}>{tile(before[i], "before")}{tile(after[i], "after")}</div>)}
  {extras.length > 0 && <div className="media-strip">{extras.map(m => tile(m, m.label))}</div>}
  {!shown.length && <p className="empty-media">No {filter === "all" ? "media" : filter === "video" ? "videos" : "photos"} in this session.</p>}
  <dialog ref={dialog} className="media-dialog" aria-label={open ? mediaName(open) : "Media preview"} onClose={() => setOpenId(null)} onCancel={() => setOpenId(null)}>
   <div className="media-dialog-actions"><span>{open ? mediaName(open) : "Media preview"}</span><button className="button" onClick={() => setOpenId(null)} aria-label="Close media">Close ×</button></div>
   {open && (open.kind === "video" ? <video key={open.id} src={open.stream} poster={open.thumbnail} controls playsInline preload="metadata" /> : <img src={open.stream} alt={mediaName(open)} />)}
   {open && <a className="button primary" href={open.download} download><DownloadIcon />Download original {open.kind}</a>}
  </dialog>
 </>;
}
export function Comparison({ before, after }: { before: MediaItem; after: MediaItem }) { const [cut, setCut] = useState(50); return <div className="comparison"><img src={before.thumbnail} alt="Before treatment" /><img src={after.thumbnail} alt="After treatment" style={{ clipPath: `inset(0 0 0 ${cut}%)` }} /><div className="comparison-divider" style={{ left: `${cut}%` }}>↔</div><span className="compare-before">Before</span><span className="compare-after">After</span><input type="range" min={2} max={98} value={cut} onChange={e => setCut(Number(e.target.value))} aria-label="Compare before and after" /></div>; }
