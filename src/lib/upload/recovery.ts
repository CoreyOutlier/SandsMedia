import type { FilePlan } from "./validation";

export class UploadRequestError extends Error {
  readonly code:string;
  readonly status:number;
  constructor(message:string,code:string,status:number) { super(message); this.name="UploadRequestError";this.code=code;this.status=status; }
}

// These start validations run before any upload can be created. A rejection is
// conclusive only on the first request, never after an uncertain network result.
const rejectedStartCodes=new Set(["INVALID_UPLOAD","INVALID_DATE","INVALID_PATIENT","INVALID_FIELDS","REQUIRED_FIELDS","INVALID_CONSENT","FILE_COUNT","INVALID_FILE","UNSUPPORTED_FILE","FILE_TOO_LARGE","INVALID_DIMENSIONS","VIDEO_TOO_LONG","INVALID_LABEL","INVALID_MEDIA_TITLE"]);
export function canDiscardStart(error:unknown,firstAttempt:boolean) {
  return firstAttempt && error instanceof UploadRequestError && error.status===400 && rejectedStartCodes.has(error.code);
}
export function unavailableResume(error:unknown) {
  return error instanceof UploadRequestError && error.status===404 && error.code==="UPLOAD_NOT_FOUND";
}

export const pendingUploadKey="posting-center-pending-upload";
type PendingStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
const unavailableStorage:PendingStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
export function pendingStorage():PendingStorage {try{return sessionStorage;}catch{return unavailableStorage;}}
export function readPendingUpload(storage:PendingStorage):string|null {
  try {
    const id=storage.getItem(pendingUploadKey);
    if(id && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return id;
    storage.removeItem(pendingUploadKey);
  }catch { /* Saving remains available when browser storage is disabled. */ }
  return null;
}
export function rememberUpload(storage:PendingStorage,id:string) {try{storage.setItem(pendingUploadKey,id);}catch{}}
export function forgetUpload(storage:PendingStorage,id?:string) {try{if(!id||storage.getItem(pendingUploadKey)===id)storage.removeItem(pendingUploadKey);}catch{}}

// Restoring a different manifest must not leave unrelated selections attached.
// Match each saved slot once, including duplicate images with the same fingerprint.
export function reconcileSelection<T extends {plan:{key:string;fingerprint:string};progress:number}>(selected:T[],plans:FilePlan[]) {
  const remaining=[...plans],kept:Array<T & {plan:FilePlan}>=[],discarded:T[]=[];
  for(const file of selected){
    let index=remaining.findIndex(p=>p.key===file.plan.key && p.fingerprint===file.plan.fingerprint);
    if(index<0)index=remaining.findIndex(p=>p.fingerprint===file.plan.fingerprint);
    if(index<0){discarded.push(file);continue;}
    const [plan]=remaining.splice(index,1);
    kept.push({...file,plan,progress:plan.confirmed?100:0});
  }
  return {kept,discarded};
}
