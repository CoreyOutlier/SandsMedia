import imageCompression from "browser-image-compression";
import type { FilePlan, Label } from "./validation";
export type PickedFile={plan:Omit<FilePlan,"label"> & {label:Label|""};file:File;preview:string;progress:number};
export async function prepareFile(input:File,maxVideoMB:number):Promise<PickedFile> {
  const video=input.type.startsWith("video/");
  if(!video && !input.type.startsWith("image/"))throw new Error("Choose a photo or video.");
  if(video && input.size>maxVideoMB*1024*1024)throw new Error(`Each video must be ${maxVideoMB} MB or smaller.`);
  if(video && !["video/mp4","video/quicktime","video/webm","video/x-m4v"].includes(input.type))throw new Error("This video format is not supported. Choose an MP4, MOV, or WebM video.");
  let file=input;
  if(!video) {
    try {file=await imageCompression(input,{maxWidthOrHeight:2048,initialQuality:0.85,fileType:"image/jpeg",preserveExif:false,useWebWorker:false});}
    catch {throw new Error("This photo could not be converted. Export it as JPEG and select it again.");}
  }
  const preview=URL.createObjectURL(file);
  let dimensions:{width:number;height:number;durationS:number|null};
  try {
    dimensions=await new Promise((resolve,reject)=>{
      const element=document.createElement(video?"video":"img");const timer=setTimeout(()=>{element.removeAttribute("src");reject(new Error("Unable to read this file. Choose it again."));},15000);
      element.onerror=()=>{clearTimeout(timer);reject(new Error("This media format cannot be read by your browser."));};
      if(element instanceof HTMLVideoElement){element.preload="metadata";element.onloadedmetadata=()=>{clearTimeout(timer);resolve({width:element.videoWidth,height:element.videoHeight,durationS:element.duration});};}
      else element.onload=()=>{clearTimeout(timer);resolve({width:element.naturalWidth,height:element.naturalHeight,durationS:null});};
      element.src=preview;
    });
    if(video && (!dimensions.durationS || !Number.isFinite(dimensions.durationS)||dimensions.durationS>180))throw new Error("Each video must be three minutes or shorter.");
  }catch(e){URL.revokeObjectURL(preview);throw e;}
  // A bounded fingerprint matches reselected files to a saved manifest after a
  // page restart. It is not presented as a cryptographic content checksum.
  const sample=new Blob([file.slice(0,65536),file.slice(Math.max(0,file.size-65536)),`${file.size}:${file.type}`]);
  const digest=await crypto.subtle.digest("SHA-256",await sample.arrayBuffer());
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return {file,preview,progress:0,plan:{key:crypto.randomUUID(),fingerprint,kind:video?"video":"photo",label:"",mimeType:video?file.type:"image/jpeg",bytes:file.size,...dimensions,name:"",title:null}};
}
export async function api<T>(path:string,body?:unknown):Promise<T> {
  let response:Response;
  try {response=await fetch(path,{method:body===undefined?"GET":"POST",headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(75000)});}
  catch {throw new Error("Connection lost. Keep this page open and tap Resume upload when you are online.");}
  let data;try{data=await response.json();}catch{throw new Error("The server took too long to respond. Tap Resume upload; saved files will not be duplicated.");}
  if(!response.ok) {
    const messages:Record<string,string>={UPLOAD_UNAVAILABLE:"The server could not complete this step. Tap Resume upload to retry safely.",FILE_NOT_CONFIRMED:"Drive is still processing this file. Wait a moment, then tap Resume upload.",SIGN_IN_REQUIRED:"Your sign-in expired. Sign in again to continue.",UPLOAD_SETUP_REQUIRED:"Storage is not connected yet. Your files have not been uploaded.",PATIENT_ARCHIVED:"This patient is archived. Restore the patient from the library before adding or resuming uploads.",INVALID_MEDIA_TITLE:"Video titles must be 120 characters or fewer.",CONSENT_WITHDRAWN:"This patient’s consent has been withdrawn. Contact the clinic before adding media.",UPLOAD_NOT_FOUND:"This upload is unavailable for your account.",UPLOAD_INCOMPLETE:"Some files are not finished. Resume the upload to complete them.",DRIVE_UNAVAILABLE:"Drive could not be reached. Please try again.",PASSCODE_INCORRECT:"That passcode is incorrect.",TOO_MANY_ATTEMPTS:"Too many attempts. Try again in 15 minutes.",FILE_TOO_LARGE:"One of the files exceeds the upload limit.",INVALID_FIELDS:"Please check the information you entered.",REQUIRED_FIELDS:"Please complete the required fields.",CONSENT_FILE_CONFLICT:"The consent record needs review. Contact your portal administrator."};
    throw new Error(messages[data.error]??"The upload could not be completed. Your confirmed files are safe; try again.");
  }
  return data;
}
export async function transfer(file:File,url:string,progress:(value:number)=>void,signal:AbortSignal) {
  let offset=0;let failures=0;
  const query=async()=>{
    const r=await fetch(url,{method:"PUT",headers:{"Content-Range":`bytes */${file.size}`},body:new Blob([]),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
    if(r.status===200||r.status===201)return {done:true,offset:file.size};
    if(r.status===404||r.status===410)throw new Error("SESSION_EXPIRED");
    if(r.status!==308)throw new Error("RETRY");
    const range=r.headers.get("Range");return {done:false,offset:range?Number(range.split("-")[1])+1:0};
  };
  while(!signal.aborted) {
    try {
      const status=await query();offset=status.offset;if(status.done){progress(100);return;}
      while(offset<file.size) {
        const end=Math.min(offset+8*1024*1024,file.size);
        const response=await fetch(url,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream","Content-Range":`bytes ${offset}-${end-1}/${file.size}`},body:file.slice(offset,end),signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])});
        if(response.status===200||response.status===201){progress(100);return;}
        if(response.status===404||response.status===410)throw new Error("SESSION_EXPIRED");
        if(response.status!==308)throw new Error("RETRY");
        const range=response.headers.get("Range");const next=range?Number(range.split("-")[1])+1:0;
        if(!Number.isSafeInteger(next)||next<=offset||next>file.size)throw new Error("RETRY");
        offset=next;failures=0;progress(Math.floor(offset/file.size*100));
      }
    }catch(e) {
      if(signal.aborted)throw new Error("Upload paused. Tap Resume upload to continue.");
      if((e as Error).message==="SESSION_EXPIRED")throw e;
      if(++failures>5)throw new Error("Connection interrupted. Keep this page open and tap Resume upload to continue.");
      await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**failures,10000)));
    }
  }
  throw new Error("Upload paused. Tap Resume upload to continue.");
}
