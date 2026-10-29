"use client";
import { useEffect,useRef,useState } from "react";
import type { MediaItem } from "./types";
export function MediaGallery({media,filter="all",pairs=true}:{media:MediaItem[];filter?:string;pairs?:boolean}){
 const [open,setOpen]=useState<MediaItem|null>(null);const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 const collectionKey=media.map(m=>m.id).join(",");
 useEffect(()=>{setOpen(null);},[filter,collectionKey]);
 const shown=media.filter(m=>filter==="all"||m.kind===filter);
 const before=pairs?shown.filter(m=>m.kind==="photo"&&m.label==="before"):[];const after=pairs?shown.filter(m=>m.kind==="photo"&&m.label==="after"):[];
 const extras=pairs?shown.filter(m=>m.kind!=="photo"||!["before","after"].includes(m.label)):shown;
 const tile=(m:MediaItem|undefined,label:string)=>m?<button type="button" className="gallery-tile" key={m.id} onClick={()=>setOpen(m)} aria-label={`Open ${m.kind}: ${m.label}`}><img src={m.thumbnail} alt={`${m.label} ${m.kind}`} loading="lazy"/><span className="gallery-label">{m.label}{m.kind==="video"?" video":""}</span>{m.kind==="video"&&<span className="video-play" aria-hidden="true">▶</span>}</button>:<div className="gallery-missing">No {label} yet</div>;
 return <>{Array.from({length:Math.max(before.length,after.length)},(_,i)=><div className="media-pair" key={i}>{tile(before[i],"before")}{tile(after[i],"after")}</div>)}{extras.length>0&&<div className="media-strip">{extras.map(m=>tile(m,m.label))}</div>}{!shown.length&&<p className="empty-media">No {filter==="all"?"media":filter==="video"?"videos":"photos"} in this session.</p>}
 <dialog ref={dialog} className="media-dialog" onClose={()=>setOpen(null)} onCancel={()=>setOpen(null)}><div className="media-dialog-actions"><span>{open?.label} {open?.kind}</span><button className="button" onClick={()=>setOpen(null)} aria-label="Close media">Close ×</button></div>{open&&(open.kind==="video"?<video key={open.id} src={open.stream} poster={open.thumbnail} controls playsInline preload="metadata"/>:<img src={open.stream} alt={`${open.label} photo`}/>)}{open&&<a className="button primary" href={open.download}>Download original</a>}</dialog></>;
}
export function Comparison({before,after}:{before:MediaItem;after:MediaItem}){const [cut,setCut]=useState(50);return <div className="comparison"><img src={before.thumbnail} alt="Before treatment"/><img src={after.thumbnail} alt="After treatment" style={{clipPath:`inset(0 0 0 ${cut}%)`}}/><div className="comparison-divider" style={{left:`${cut}%`}}>↔</div><span className="compare-before">Before</span><span className="compare-after">After</span><input type="range" min={2} max={98} value={cut} onChange={e=>setCut(Number(e.target.value))} aria-label="Compare before and after"/></div>;}
