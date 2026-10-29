"use client";
import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { CONSENT_TEXT,CONSENT_TEXT_VERSION } from "@/lib/consent";
import { api,prepareFile,transfer,type PickedFile } from "@/lib/upload/browser";
import { labels,type FilePlan } from "@/lib/upload/validation";
import { MAX_VIDEO_MB } from "@/lib/upload/limits";
import { fileSize } from "@/lib/media-format";
import { canDiscardStart,unavailableResume,readPendingUpload,pendingStorage,rememberUpload,forgetUpload,reconcileSelection } from "@/lib/upload/recovery";
type Patient={id:string;firstName:string;lastName:string;displayId:string;consentWithdrawn:boolean};
type Batch={id:string;general:boolean;finished:boolean;date:string;title:string;description:string;uploadedBy:string;consented:boolean;formOnFile:boolean;patient:Patient|null;files:FilePlan[]};
type Success={count:number;path:string;driveUrl:string;general:boolean;consented:boolean;consentWithdrawn:boolean;patientId?:string};
export function UploadForm({maxVideoMB=MAX_VIDEO_MB,initialGeneral=false,initialPatient=null,initialUploader="",ready=true,testMode=true}:{maxVideoMB?:number;initialGeneral?:boolean;initialPatient?:Patient|null;initialUploader?:string;ready?:boolean;testMode?:boolean}) {
  const [general,setGeneral]=useState(initialGeneral);const [query,setQuery]=useState("");const [hits,setHits]=useState<Patient[]>([]);const [patient,setPatient]=useState<Patient|null>(initialPatient);const [newPatient,setNewPatient]=useState(false);
  const [first,setFirst]=useState("");const [last,setLast]=useState("");const [title,setTitle]=useState("");const [description,setDescription]=useState("");const [uploader,setUploader]=useState(initialUploader);
  const [date,setDate]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;});
  const [consented,setConsented]=useState(false);const [formOnFile,setFormOnFile]=useState(false);const [files,setFiles]=useState<PickedFile[]>([]);const [batch,setBatch]=useState<Batch|null>(null);
  const [testConfirmed,setTestConfirmed]=useState(false);
  const [pending,setPending]=useState<string|null>(null);const [resumeUnavailable,setResumeUnavailable]=useState(false);const [busy,setBusy]=useState(false);const [preparing,setPreparing]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");const [success,setSuccess]=useState<Success|null>(null);
  const abort=useRef<AbortController|null>(null);const fileRef=useRef<PickedFile[]>([]);const input=useRef<HTMLInputElement>(null);const generation=useRef(0);const attemptId=useRef<string|null>(null);
  useEffect(()=>{setPending(readPendingUpload(pendingStorage()));return()=>{abort.current?.abort();fileRef.current.forEach(f=>URL.revokeObjectURL(f.preview));};},[]);
  useEffect(()=>{fileRef.current=files;},[files]);
  useEffect(()=>{if(!busy)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[busy]);
  useEffect(()=>{
    const n=++generation.current;if(query.trim().length<2||patient||newPatient){setHits([]);return;}
    const timer=setTimeout(()=>{api<{patients:Patient[]}>("/api/patients/search",{q:query}).then(r=>{if(n===generation.current)setHits(r.patients);}).catch(()=>{if(n===generation.current)setError("Patient search is unavailable. Please try again before adding a patient.");});},150);
    return()=>clearTimeout(timer);
  },[query,patient,newPatient]);
  async function add(selected:FileList|File[]) {
    if(busy||preparing)return;setPreparing(true);setError("");const additions:PickedFile[]=[];
    try {
      if(files.length+selected.length>100)throw new Error("Choose up to 100 files per upload.");
      for(const f of Array.from(selected)) {
        setMessage(`Preparing file ${additions.length+1} of ${selected.length}…`);
        const item=await prepareFile(f,maxVideoMB);
        if(batch){const plan=batch.files.find(p=>!p.confirmed&&p.fingerprint===item.plan.fingerprint&&!files.some(x=>x.plan.key===p.key)&&!additions.some(x=>x.plan.key===p.key));if(!plan){URL.revokeObjectURL(item.preview);throw new Error("Select the original unfinished files for this upload. Start a new upload for different files.");}item.plan=plan;}
        additions.push(item);
      }
      setFiles(old=>[...old,...additions]);setMessage("");
    }catch(e){additions.forEach(f=>URL.revokeObjectURL(f.preview));setError((e as Error).message);setMessage("");}finally{setPreparing(false);if(input.current)input.current.value="";}
  }
  function updateProgress(key:string,progress:number){setFiles(old=>old.map(f=>f.plan.key===key?{...f,progress}:f));}
  async function restore() {
    const id=attemptId.current??pending;if(!id||busy||preparing)return;setBusy(true);setError("");setResumeUnavailable(false);
    try{
      const b=await api<Batch>(`/api/uploads/${id}/status`);
      const restored=reconcileSelection(fileRef.current,b.files);
      restored.discarded.forEach(f=>URL.revokeObjectURL(f.preview));setFiles(restored.kept);fileRef.current=restored.kept;
      setBatch(b);attemptId.current=b.id;rememberUpload(pendingStorage(),b.id);setGeneral(b.general);setPatient(b.patient);setNewPatient(false);setTitle(b.title);setDate(b.date);setDescription(b.description);setUploader(b.uploadedBy);setConsented(b.consented);setFormOnFile(b.formOnFile);setPending(null);
      const needsFiles=b.files.some(f=>!f.confirmed&&!restored.kept.some(p=>p.plan.key===f.key));
      setMessage(b.files.every(f=>f.confirmed)?"All files are uploaded. Tap Finish saving to complete this upload.":needsFiles?"Choose the original unfinished files below, then tap Resume upload. Saved files will be skipped.":"Your files are ready. Tap Resume upload to continue from the last saved step.");
    }catch(e){setMessage("");if(unavailableResume(e)){setResumeUnavailable(true);requestAnimationFrame(()=>document.getElementById("resume-recovery")?.scrollIntoView({block:"center",behavior:"smooth"}));}else setError((e as Error).message);}finally{setBusy(false);}
  }
  function dismissPending(){forgetUpload(pendingStorage());setPending(null);attemptId.current=null;setResumeUnavailable(false);setError("");setMessage("");}
  function reset(){abort.current?.abort();files.forEach(f=>URL.revokeObjectURL(f.preview));setFiles([]);fileRef.current=[];setBatch(null);dismissPending();setSuccess(null);setPatient(null);setNewPatient(false);setFirst("");setLast("");setQuery("");setTitle("");setDescription("");setConsented(false);setFormOnFile(false);}
  function startFresh(){if(busy||preparing)return;if(batch||attemptId.current)reset();else dismissPending();}
  function beginNewPatient(){
    const parts=query.trim().split(/\s+/).filter(Boolean);
    setFirst(parts.shift()??"");setLast(parts.join(" "));setNewPatient(true);setHits([]);setError("");
    requestAnimationFrame(()=>{const field=document.getElementById("first");field?.focus();field?.scrollIntoView({block:"center",behavior:"smooth"});});
  }
  async function submit(e:React.FormEvent){
    e.preventDefault();if(busy||preparing||resumeUnavailable)return;
    if(!batch){
      if(!general&&!patient&&!newPatient&&query.trim()){
        beginNewPatient();setError("Confirm the first and last name above, then tap Save to create this patient and upload your files. If this is an existing patient, choose Search existing patients instead.");return;
      }
      let problem="";let field="";
      if(!general&&!patient&&!newPatient){problem="Choose a matching patient, or tap Add a new patient and enter their name.";field="patient-search";}
      else if(!general&&!patient&&(!first.trim()||!last.trim())){problem="Enter the patient’s first and last name.";field=!first.trim()?"first":"last";}
      else if(!title.trim()){problem=general?"Enter a title for this upload.":"Enter the treatment for this upload.";field="upload-title";}
      else if(!date){problem="Choose the upload date.";field="upload-date";}
      else if(!uploader.trim()){problem="Enter who is uploading these files.";field="uploaded-by";}
      else if(!files.length){problem="Add at least one photo or video before saving.";field="media-files";}
      else if(!general&&files.some(f=>!f.plan.label)){const index=files.findIndex(f=>!f.plan.label);problem=`Choose a category for file ${index+1}: Before, After, Testimonial, or Other.`;field=`file-label-${files[index].plan.key}`;}
      else if(testMode&&!testConfirmed){problem="Confirm these are sample files before saving in test mode.";}
      if(problem){setError(problem);document.getElementById(field)?.focus();document.getElementById(field)?.scrollIntoView({block:"center",behavior:"smooth"});return;}
    }
    setBusy(true);setError("");abort.current=new AbortController();let starting=false;let firstAttempt=false;
    try {
      let b=batch;
      if(!b){starting=true;firstAttempt=!attemptId.current;const id=attemptId.current??crypto.randomUUID();attemptId.current=id;setPending(null);rememberUpload(pendingStorage(),id);b=await api<Batch>("/api/uploads/start",{uploadId:id,kind:general?"general":"patient",patientId:patient?.id??null,firstName:first,lastName:last,title,treatment:title,date,description,uploadedBy:uploader,consented:general?false:consented,formOnFile:general?false:formOnFile,files:files.map(f=>({...f.plan,label:general?"other":f.plan.label}))});starting=false;setPending(null);setBatch(b);setPatient(b.patient);}
      for(const [index,plan] of b.files.entries()) {
        if(plan.confirmed)continue;
        const file=files.find(f=>f.plan.key===plan.key);if(!file)throw new Error("Reselect all unfinished files to resume this upload.");
        setMessage(`Uploading ${index+1} of ${b.files.length}. Keep this page open.`);
        let signed=await api<{url?:string;driveId:string;complete:boolean}>(`/api/uploads/${b.id}/sign`,{key:plan.key});
        if(!signed.complete){try{await transfer(file.file,signed.url!,p=>updateProgress(plan.key,p),abort.current.signal);}catch(e){if((e as Error).message!=="SESSION_EXPIRED")throw e;await api(`/api/uploads/${b.id}/renew`,{key:plan.key});signed=await api(`/api/uploads/${b.id}/sign`,{key:plan.key});if(!signed.complete)await transfer(file.file,signed.url!,p=>updateProgress(plan.key,p),abort.current.signal);}}
        await api(`/api/uploads/${b.id}/media`,{key:plan.key});plan.confirmed=true;updateProgress(plan.key,100);setBatch({...b,files:[...b.files]});
      }
      setMessage("Finishing your upload…");const saved=await api<Success>(`/api/uploads/${b.id}/finish`,{});setSuccess(saved);forgetUpload(pendingStorage(),b.id);setPending(null);setMessage("");
    }catch(e){if(starting&&canDiscardStart(e,firstAttempt)){forgetUpload(pendingStorage(),attemptId.current??undefined);attemptId.current=null;setPending(null);}if(unavailableResume(e)){setResumeUnavailable(true);requestAnimationFrame(()=>document.getElementById("resume-recovery")?.scrollIntoView({block:"center",behavior:"smooth"}));}else setError((e as Error).message);setMessage("");}finally{setBusy(false);}
  }
  if(success)return <section className="upload-page"><div className="upload-success"><Icon name="upload"/><p className="eyebrow">Upload complete</p><h1>Saved to Drive</h1><p>{success.count} files saved. {success.general?"Your footage is private.":success.consentWithdrawn?"Saved privately. Consent is still withdrawn, so posting and sharing remain blocked.":success.consented?"Consent recorded for this session.":"Not cleared for social."}</p><div className="upload-path">{success.path}<small>Photos and Videos are organized separately.</small></div><div className="upload-actions"><button className="button primary" onClick={reset}>Upload another</button><a className="button" href={success.driveUrl} target="_blank" rel="noreferrer">Open folder in Drive</a><Link className="button quiet" href={success.general?"/other-uploads":`/patients?patient=${success.patientId??""}`}>{success.general?"View uploads":"View patient"}</Link></div></div></section>;
  const locked=busy||!!batch||!!attemptId.current;
  return <section className="upload-page"><header><p className="eyebrow">Posting Center / Upload</p><h1>New upload</h1><p className="lede">Photos, videos, and the details that keep everything organized.</p></header>
    {testMode&&<div className="upload-notice"><strong>Test portal — sample data only</strong><p>Use made-up patient names and sample photos or videos until the practice’s patient-data setup is approved.</p><label className="consent-choice"><input type="checkbox" checked={testConfirmed} disabled={busy} onChange={e=>setTestConfirmed(e.target.checked)}/><span>These files contain no real patient information.</span></label></div>}
    {!ready&&<div className="upload-notice" role="status">Storage setup is in progress. You can review this form; saving will be available when the connection is verified.</div>}
    {pending&&!batch&&!resumeUnavailable&&<div className="upload-notice"><strong>You have an unfinished upload.</strong><p>Resume it without creating duplicate files.</p><div className="upload-actions"><button className="button" onClick={restore} disabled={busy||preparing}>Resume previous upload</button><button className="button quiet" disabled={busy||preparing} onClick={startFresh}>Start a different upload</button></div></div>}
    <form onSubmit={submit} noValidate>
      <fieldset disabled={locked} className="upload-fields"><legend className="sr-only">Upload information</legend>
        <div className="upload-kind" role="group" aria-label="Upload destination"><button type="button" aria-pressed={!general} onClick={()=>setGeneral(false)}><Icon name="patients"/>Patient</button><button type="button" aria-pressed={general} onClick={()=>setGeneral(true)}><Icon name="media"/>Other uploads</button></div>
        {!general?<div className="upload-field"><label htmlFor="patient-search">Patient <span>Required</span></label>{patient?<div className="patient-choice"><strong>{patient.firstName} {patient.lastName}</strong><span>{patient.displayId}</span><button type="button" className="button quiet" onClick={()=>setPatient(null)}>Change</button></div>:<>{!newPatient&&<><input id="patient-search" value={query} onChange={e=>{setQuery(e.target.value);setError("");}} placeholder="Search existing patients by name or ID" aria-describedby="patient-help" autoComplete="off"/><p id="patient-help" className="upload-hint">Choose a result to use an existing folder, or add a new patient below.</p>{hits.length>0&&<div className="patient-options">{hits.map(p=><button key={p.id} type="button" onClick={()=>{setPatient(p);setHits([]);setError("");}}>{p.firstName} {p.lastName}<span>{p.displayId}</span></button>)}</div>}</>}<button type="button" className="button" onClick={()=>{if(newPatient){setNewPatient(false);setError("");}else beginNewPatient();}}>{newPatient?"Search existing patients":query.trim()?"+ Add this name as a new patient":"+ Add a new patient"}</button>{newPatient&&<p className="upload-hint">New patient — confirm their name. Their private folder will be created when you save.</p>}{newPatient&&<div className="upload-columns"><div><label htmlFor="first">First name</label><input id="first" value={first} onChange={e=>setFirst(e.target.value)} maxLength={80} required autoComplete="off"/></div><div><label htmlFor="last">Last name</label><input id="last" value={last} onChange={e=>setLast(e.target.value)} maxLength={80} required autoComplete="off"/></div></div>}</>}</div>:<p className="upload-hint">For team content, office footage, and other media without a patient. Use Patient uploads for patient images and consent.</p>}
        <div className="upload-columns"><div className="upload-field"><label htmlFor="upload-title">{general?"Title":"Treatment"} <span>Required</span></label><input id="upload-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder={general?"e.g. Office tour":"e.g. Porcelain veneers"} maxLength={120} required/></div><div className="upload-field"><label htmlFor="upload-date">Date</label><input id="upload-date" type="date" value={date} onChange={e=>setDate(e.target.value)} required/></div></div>
        <div className="upload-field"><label htmlFor="upload-description">Description / notes</label><textarea id="upload-description" rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="A short note about this upload" maxLength={2000}/></div>
        <div className="upload-field"><label htmlFor="uploaded-by">Uploaded by <span>Required</span></label><input id="uploaded-by" value={uploader} onChange={e=>setUploader(e.target.value)} maxLength={100} placeholder="Your name" required/></div>
      </fieldset>
      <div className="upload-field"><label htmlFor="media-files">Photos and videos <span>Choose several together</span></label><div className="upload-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!locked||batch)void add(e.dataTransfer.files);}}><Icon name="upload"/><strong>Add photos and videos</strong><p>Choose several files, or drag them here.</p><input ref={input} id="media-files" type="file" accept="image/*,video/*" multiple disabled={busy||preparing||(!!attemptId.current&&!batch)} onChange={e=>{if(e.target.files)void add(e.target.files);}}/><small>Videos: up to {fileSize(maxVideoMB*1024*1024)} and 2 hours each. Original video quality is preserved. Photos are resized for upload.</small></div></div>
      {!general&&files.length>0&&!locked&&<p className="upload-notice">Choose Before, After, Testimonial, or Other for each file below. Categories are never assigned automatically. You can change them until saving starts.</p>}
      <div className="upload-tiles">{files.map((f,i)=><article className="upload-tile" key={f.plan.key}>{f.plan.kind==="video"?<video src={f.preview} muted playsInline preload="metadata"/>:<img src={f.preview} alt={`Selected photo ${i+1}`}/>}<span className="media-type">{f.plan.kind==="video"?"Video":"Photo"} · {fileSize(f.file.size)}</span>{!locked&&<button className="remove-file" aria-label={`Remove file ${i+1}`} type="button" onClick={()=>{URL.revokeObjectURL(f.preview);setFiles(old=>old.filter(x=>x!==f));}}>×</button>}{!general&&<div className="upload-label-choice"><label htmlFor={`file-label-${f.plan.key}`}>What is this {f.plan.kind}? <span>Required</span></label><select id={`file-label-${f.plan.key}`} aria-label={`Category for file ${i+1}`} required disabled={locked} value={f.plan.label} onChange={e=>setFiles(old=>old.map(x=>x===f?{...x,plan:{...x.plan,label:e.target.value as FilePlan["label"]}}:x))}>{!f.plan.label&&<option value="" disabled>Choose a category…</option>}{labels.map(label=><option key={label} value={label}>{label.charAt(0).toUpperCase()+label.slice(1)}</option>)}</select></div>}{f.plan.kind==="video"&&<div className="upload-label-choice upload-video-title"><label htmlFor={`file-title-${f.plan.key}`}>Video title <span>Optional · up to 120 characters</span></label><input id={`file-title-${f.plan.key}`} aria-label={`Title for video ${i+1}`} type="text" maxLength={120} disabled={locked} value={f.plan.title??""} placeholder="e.g. Smile reveal, first take" autoComplete="off" onChange={e=>setFiles(old=>old.map(x=>x===f?{...x,plan:{...x.plan,title:e.target.value}}:x))}/></div>}{batch&&<><progress value={f.progress} max={100} aria-label={`File ${i+1} progress`}/><small>{batch.files.find(x=>x.key===f.plan.key)?.confirmed?"Saved":`${f.progress}%`}</small></>}</article>)}</div>
      {batch&&<p className="upload-hint">{batch.files.filter(f=>f.confirmed).length} of {batch.files.length} files confirmed. Your upload information is locked to keep retries consistent.</p>}
      {!general&&<fieldset className={`consent-box ${consented?"checked":""}`} disabled={locked}><legend>Consent for posting and sharing</legend><label className="consent-choice"><input type="checkbox" checked={consented} onChange={e=>{setConsented(e.target.checked);if(!e.target.checked)setFormOnFile(false);}}/><span>{CONSENT_TEXT}</span></label><label className="consent-choice secondary"><input type="checkbox" checked={formOnFile} onChange={e=>{setFormOnFile(e.target.checked);if(e.target.checked)setConsented(true);}}/><span>Signed consent form is on file at the clinic.</span></label><p>{patient?.consentWithdrawn?"You can upload these files privately. Posting and sharing remain blocked until you record new consent on the patient page. Checking this box records consent for this upload only; it does not undo a withdrawal.":consented?"Consent will be recorded for this session. You can also leave this unchecked and save privately.":"Photos and videos still save privately. Nothing can be posted or shared without consent."}</p><small>Consent text version {CONSENT_TEXT_VERSION}</small></fieldset>}
      {resumeUnavailable&&<div id="resume-recovery" className="upload-notice" role="alert"><strong>Let’s recover your upload</strong><p>This saved upload could not be found for this sign-in. It may not have started, or it may belong to a different sign-in. Any files already saved have not been changed.</p><p>If you changed accounts, return to the original sign-in and try again. Otherwise, check your saved files before starting a new upload.</p><div className="upload-actions"><button type="button" className="button" onClick={restore} disabled={busy||preparing}>Try resume again</button><Link className="button quiet" href={general?"/other-uploads":"/patients"}>Check saved files</Link><button type="button" className="button" onClick={startFresh} disabled={busy||preparing}>Start a new upload</button></div></div>}
      <div aria-live="polite">{message&&<p className="upload-notice">{message}</p>}{error&&<p className="upload-error" role="alert">{error}</p>}</div>
      <div className="upload-actions"><button className="button primary" type="submit" disabled={!ready||busy||preparing||resumeUnavailable}>{busy?"Saving to Drive…":batch?.files.every(f=>f.confirmed)?"Finish saving":batch||attemptId.current?"Resume upload":"Save to Drive"}</button>{busy&&<button type="button" className="button" onClick={()=>abort.current?.abort()}>Pause</button>}{!busy&&!resumeUnavailable&&(batch||attemptId.current)&&<button type="button" className="button quiet" disabled={preparing} onClick={reset}>Start a different upload</button>}</div>
      <p className="upload-hint"><Icon name="lock"/> Files stay in your private clinic storage. Keep this page open until saving finishes.</p>
    </form>
  </section>;
}
