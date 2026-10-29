"use client";
import { useEffect, useRef, useState } from "react";
import { portalApi, type MediaItem } from "./types";
import { fileSize, mediaDuration } from "@/lib/media-format";

function DownloadIcon() {
 return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" /></svg>;
}
const mediaName = (item: MediaItem) => item.title || `${item.label.charAt(0).toUpperCase()}${item.label.slice(1)} ${item.kind}`;

function MediaCard({ item, onOpen, editable, general, onRenamed }: { item: MediaItem; onOpen: () => void; editable: boolean; general: boolean; onRenamed?: (id: string, title: string | null) => void }) {
 const [editing, setEditing] = useState(false);
 const [title, setTitle] = useState(item.title ?? "");
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState("");
 const [saved, setSaved] = useState(false);
 const [previewAttempt, setPreviewAttempt] = useState(0);
 const [previewUnavailable, setPreviewUnavailable] = useState(false);
 useEffect(() => { setPreviewAttempt(0); setPreviewUnavailable(false); }, [item.thumbnail]);
 async function saveTitle() {
  if (busy || !title.trim()) return;
  setBusy(true); setError(""); setSaved(false);
  try {
   const updated = await portalApi<{ title: string | null }>(`/api/media/${item.id}/title`, { title: title.trim(), general });
   onRenamed?.(item.id, updated.title); setEditing(false); setSaved(true);
  } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
 }
 return <article className="media-card">
  <button type="button" className="gallery-tile" onClick={onOpen} aria-label={`Open ${mediaName(item)}`}>
   {previewUnavailable ? <span className="media-preview-unavailable"><span>{item.kind === "video" ? "▶" : "↗"}</span>Open {item.kind}<small>Preview unavailable. Your saved file is unchanged.</small></span> : <img src={item.thumbnail + (previewAttempt ? `${item.thumbnail.includes("?") ? "&" : "?"}previewRetry=1` : "")} alt={mediaName(item)} loading="lazy" onError={() => { if (previewAttempt === 0) setPreviewAttempt(1); else setPreviewUnavailable(true); }} />}
   <span className="gallery-label">{item.label}{item.kind === "video" ? " video" : ""}</span>
   {item.kind === "video" && <span className="video-play" aria-hidden="true">▶</span>}
  </button>
  <div className="media-card-body">
   <div className="media-card-caption"><strong>{mediaName(item)}</strong><span>{fileSize(item.bytes)}{item.kind === "video" && item.durationS ? ` · ${mediaDuration(item.durationS)}` : ""}</span></div>
   <div className="media-card-actions"><a className="media-download" href={item.download} download><DownloadIcon /><span>Download {item.kind}</span></a>{editable && item.kind === "video" && <button className="media-name-action" onClick={() => { setEditing(!editing); setTitle(item.title ?? ""); setError(""); setSaved(false); }} aria-expanded={editing} aria-label={`${item.title ? "Edit" : "Add"} video title`}>{item.title ? "Edit title" : "Name video"}</button>}</div>
   {editing && <form className="media-title-editor" onSubmit={e => { e.preventDefault(); void saveTitle(); }}><label htmlFor={`title-${item.id}`}>Video title</label><input id={`title-${item.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} disabled={busy} autoFocus placeholder="e.g. Smile reveal" required /><div className="media-title-actions"><button className="button primary" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save title"}</button><button className="button quiet" type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button></div>{error && <p className="upload-error" role="alert">{error}</p>}</form>}
   {saved && <p className="media-saved" role="status">Video title saved.</p>}
  </div>
 </article>;
}

export function MediaGallery({ media, filter = "all", pairs = true, editable = false, general = false, onRenamed }: { media: MediaItem[]; filter?: string; pairs?: boolean; editable?: boolean; general?: boolean; onRenamed?: (id: string, title: string | null) => void }) {
 const [openId, setOpenId] = useState<string | null>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 const open = media.find(m => m.id === openId) ?? null;
 useEffect(() => { if (openId) dialog.current?.showModal(); else dialog.current?.close(); }, [openId]);
 const collectionKey = media.map(m => m.id).join(",");
 useEffect(() => { setOpenId(null); }, [filter, collectionKey]);
 const shown = media.filter(m => filter === "all" || m.kind === filter);
 const before = pairs ? shown.filter(m => m.kind === "photo" && m.label === "before") : [];
 const after = pairs ? shown.filter(m => m.kind === "photo" && m.label === "after") : [];
 const extras = pairs ? shown.filter(m => m.kind !== "photo" || !["before", "after"].includes(m.label)) : shown;
 const tile = (m: MediaItem | undefined, label: string) => m ? <MediaCard key={m.id} item={m} onOpen={() => setOpenId(m.id)} editable={editable} general={general} onRenamed={onRenamed} /> : <div className="gallery-missing">No {label} photo in this session</div>;
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
