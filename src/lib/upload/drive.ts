import { drive as createDrive, auth as googleAuth } from "googleapis/build/src/apis/drive/index.js";
import { Readable } from "node:stream";
import { UploadError, folderName } from "./validation";

let client: ReturnType<typeof createDrive> | undefined;
export function drive() {
  if(client) return client;
  try {
    const key=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON??"","base64").toString());
    if(key.type!=="service_account" || !key.client_email || !key.private_key) throw new Error();
    const auth=new googleAuth.GoogleAuth({credentials:key,scopes:["https://www.googleapis.com/auth/drive"]});
    client=createDrive({version:"v3",auth}); return client;
  } catch { throw new UploadError("UPLOAD_SETUP_REQUIRED",503); }
}
export { storageConfigured } from "./config";
const escapeQ=(s:string)=>s.replace(/\\/g,"\\\\").replace(/'/g,"\\'");
export async function getDriveFile(id:string) {
  try { return (await drive().files.get({fileId:id,supportsAllDrives:true,fields:"id,name,mimeType,size,parents,trashed,webViewLink,appProperties,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)"})).data; }
  catch(error) { if((error as {code?:number}).code===404) return null; throw new UploadError("DRIVE_UNAVAILABLE",503); }
}
// Caller holds a database advisory lock; stable appProperties allow recovery after
// a request dies between Drive creation and the database commit.
export async function ensureFolder(parent:string,name:string,key:string,adoptByName=false,collisionSuffix?:string) {
  const api=drive(); const q=`'${escapeQ(parent)}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and `+(adoptByName?`name='${escapeQ(name)}'`:`appProperties has { key='postingCenterKey' and value='${escapeQ(key)}' }`);
  const found=await api.files.list({q,supportsAllDrives:true,includeItemsFromAllDrives:true,pageSize:100,fields:"files(id),nextPageToken"});
  if(found.data.nextPageToken || (found.data.files?.length??0)>1) throw new UploadError("FOLDER_CONFLICT",409);
  if(found.data.files?.[0]?.id) return found.data.files[0].id;
  if(collisionSuffix){const sameName=await api.files.list({q:`'${escapeQ(parent)}' in parents and trashed=false and name='${escapeQ(folderName(name))}'`,supportsAllDrives:true,includeItemsFromAllDrives:true,pageSize:1,fields:"files(id)"});if(sameName.data.files?.length)name=`${folderName(name)} – ${collisionSuffix}`;}
  const created=await api.files.create({supportsAllDrives:true,requestBody:{name:folderName(name),mimeType:"application/vnd.google-apps.folder",parents:[parent],appProperties:{postingCenterKey:key}},fields:"id"});
  if(!created.data.id) throw new UploadError("DRIVE_UNAVAILABLE",503); return created.data.id;
}
export async function reserveFileId() { const r=await drive().files.generateIds({count:1,space:"drive",type:"files"}); if(!r.data.ids?.[0]) throw new UploadError("DRIVE_UNAVAILABLE",503); return r.data.ids[0]; }
export async function mintUpload(id:string,parent:string,name:string,mimeType:string,bytes:number,key:string) {
  const api=drive();
  // googleapis' auth client performs the server-authenticated initiation. Media
  // bytes then travel browser-to-Google; no upload body is sent through Next.js.
  const auth=api.context._options.auth;
  if(!auth || typeof auth==="string") throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
  const response=await auth.request({url:"https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id",method:"POST",headers:{"Content-Type":"application/json","X-Upload-Content-Type":mimeType,"X-Upload-Content-Length":String(bytes),"Origin":process.env.APP_URL??""},data:{id,name,mimeType,parents:[parent],appProperties:{postingCenterKey:key}}});
  const url=response.headers.get("location");
  if(!url || new URL(url).origin!=="https://www.googleapis.com") throw new UploadError("DRIVE_UNAVAILABLE",503);
  return url;
}
export async function writeConsentFile(parent:string,eventId:string,content:object,renewal=false) {
  const api=drive(); const name=renewal?`consent-renewal-${eventId}.json`:"consent.json";
  const q=`'${escapeQ(parent)}' in parents and trashed=false and name='${escapeQ(name)}'`;
  const found=await api.files.list({q,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:"files(id,appProperties)"});
  if(found.data.files?.length) { if(found.data.files.length!==1 || found.data.files[0].appProperties?.consentEventId!==eventId) throw new UploadError("CONSENT_FILE_CONFLICT",409); return; }
  await api.files.create({supportsAllDrives:true,requestBody:{name,parents:[parent],appProperties:{consentEventId:eventId}},media:{mimeType:"application/json",body:Readable.from([JSON.stringify(content)])},fields:"id"});
}
export async function appendConsentMirror(root:string,eventId:string,values:string[]) {
  return appendConsentMirrors(root,[{eventId,values}]);
}
export async function appendConsentMirrors(root:string,entries:{eventId:string;values:string[]}[]) {
  const api=drive();const found=await api.files.list({q:`'${escapeQ(root)}' in parents and trashed=false and name='_consent-log.csv'`,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:"files(id,size)"});
  if((found.data.files?.length??0)>1)throw new UploadError("CONSENT_FILE_CONFLICT",409);
  const entry=found.data.files?.[0];const header="event_id,patient_id,session_date,consent_text_version,consent_text,consented_by,form_on_file,timestamp,ip,user_agent\r\n";
  let previous=header;
  if(entry?.id){if(Number(entry.size)>10*1024*1024)throw new UploadError("CONSENT_LOG_REVIEW_REQUIRED",409);const r=await api.files.get({fileId:entry.id,alt:"media",supportsAllDrives:true},{responseType:"text"});previous=String(r.data);if(!previous.startsWith(header))throw new UploadError("CONSENT_FILE_CONFLICT",409);}
  const quote=(v:string)=>`"${v.replace(/"/g,'""').replace(/[\r\n]/g," ")}"`;
  let next=previous;
  for(const {eventId,values} of entries){
    const line=[eventId,...values].map(quote).join(",")+"\r\n";
    const old=next.split("\r\n").find(l=>l.startsWith(quote(eventId)+","));
    if(old){if(old+"\r\n"!==line)throw new UploadError("CONSENT_FILE_CONFLICT",409);}else next+=line;
  }
  if(next===previous)return;
  const media={mimeType:"text/csv",body:Readable.from([next])};
  if(entry?.id)await api.files.update({fileId:entry.id,supportsAllDrives:true,media,fields:"id"});
  else await api.files.create({supportsAllDrives:true,requestBody:{name:"_consent-log.csv",parents:[root]},media,fields:"id"});
}
