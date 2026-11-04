import { ZipArchive } from "archiver";
import { Readable } from "node:stream";
import { database } from "@/lib/db";
import { portalIdentity } from "@/lib/portal/access";
import { ticketShare } from "@/lib/portal/shares";
import { driveStream } from "@/lib/portal/media";
import { downloadDisposition } from "@/lib/portal/download";
import { drive } from "@/lib/upload/drive";
import { uploadFailure } from "@/lib/upload/http";
import { uuid,UploadError } from "@/lib/upload/validation";
export const maxDuration=300;
const safe=(s:string)=>s.replace(/[\\/\u0000-\u001f]/g,"_").replace(/^\.+/,"_").slice(0,180)||"media";
type ZipFile={driveFileId:string;fileName:string};
export async function GET(request:Request,{params}:{params:Promise<{kind:string;id:string}>}){try{
 const {id,kind}=await params;if(!uuid(id))throw new UploadError("MEDIA_NOT_FOUND",404);
 const db=database();const ticket=new URL(request.url).searchParams.get("ticket");
 let name="media";let folder:string|null=null;let files:ZipFile[]=[];let shareId:string|null=null;let clinicId:string|null=null;
 if(kind==="share"){
   const link=await ticketShare(ticket);if(link.id!==id)throw new UploadError("LINK_EXPIRED",404);shareId=link.id;name=link.patient.displayId;
   const sessions=await db.session.findMany({where:{patientId:link.patientId,patient:{deletedAt:null},finishedAt:{not:null},consentEvents:{some:{consented:true}}},include:{media:{where:{deletedAt:null},orderBy:{position:"asc"}}},orderBy:{date:"desc"}});
   files=sessions.flatMap(s=>s.media.map(m=>({driveFileId:m.driveFileId,fileName:`${s.date.toISOString().slice(0,10)} ${safe(s.treatment)} – ${s.id.slice(0,8)}/${m.kind==="photo"?"Photos":"Videos"}/${safe(m.fileName)}`})));
 }else{
   const {clinic}=await portalIdentity();clinicId=clinic.id;
   if(kind==="patient"){const p=await db.patient.findFirst({where:{id,clinicId,deletedAt:null}});if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);folder=p.driveFolderId;name=`${p.lastName}-${p.firstName}-${p.displayId}`;}
   else if(kind==="general"){const u=await db.generalUpload.findFirst({where:{id,clinicId}});if(!u)throw new UploadError("UPLOAD_NOT_FOUND",404);folder=u.driveFolderId;name=u.title;}
   else throw new UploadError("MEDIA_NOT_FOUND",404);
   if(!folder)throw new UploadError("UPLOAD_INCOMPLETE",409);
   // Drive cleanup may still be retrying, or a file may have been manually
   // restored there. Database removal remains authoritative for portal access.
   const [removedPatient,removedGeneral]=await Promise.all([
    db.media.findMany({where:{session:{patient:{clinicId}},OR:[{deletedAt:{not:null}},{session:{patient:{deletedAt:{not:null}}}}]},select:{driveFileId:true}}),
    db.generalMedia.findMany({where:{deletedAt:{not:null},generalUpload:{clinicId}},select:{driveFileId:true}}),
   ]);
   const removed=new Set([...removedPatient,...removedGeneral].map(m=>m.driveFileId));
   const walk=async(parent:string,path="",depth=0):Promise<void>=>{if(depth>8||files.length>5000)throw new UploadError("DOWNLOAD_TOO_LARGE",413);let pageToken:string|undefined;
    do{const page=await drive().files.list({q:`'${parent.replace(/'/g,"\\'")}' in parents and trashed=false`,pageToken,pageSize:1000,supportsAllDrives:true,includeItemsFromAllDrives:true,fields:"files(id,name,mimeType),nextPageToken"});
     for(const item of page.data.files??[]){if(!item.id||removed.has(item.id))continue;const target=path+safe(item.name??"file");if(item.mimeType==="application/vnd.google-apps.folder")await walk(item.id,target+"/",depth+1);else if(!item.mimeType?.startsWith("application/vnd.google-apps."))files.push({driveFileId:item.id,fileName:target});}pageToken=page.data.nextPageToken??undefined;
    }while(pageToken);
   };await walk(folder);
 }
 if(!files.length)throw new UploadError("NO_MEDIA",404);
 // Recheck immediately before each source opens. A delete/withdrawal that wins
 // during ZIP enumeration must not expose subsequent files from that snapshot.
 const canStream=async(file:ZipFile)=>{
  if(shareId){const link=await ticketShare(ticket);return !!await db.media.findFirst({where:{driveFileId:file.driveFileId,deletedAt:null,session:{patientId:link.patientId,patient:{deletedAt:null},finishedAt:{not:null},consentEvents:{some:{consented:true}}}},select:{id:true}});}
  if(kind==="patient"&&!await db.patient.findFirst({where:{id,clinicId:clinicId!,deletedAt:null},select:{id:true}}))throw new UploadError("PATIENT_NOT_FOUND",404);
  const [patientMedia,generalMedia]=await Promise.all([
   db.media.findUnique({where:{driveFileId:file.driveFileId},select:{deletedAt:true,session:{select:{patient:{select:{deletedAt:true}}}}}}),
   db.generalMedia.findUnique({where:{driveFileId:file.driveFileId},select:{deletedAt:true}}),
  ]);
  return !patientMedia?.deletedAt&&!patientMedia?.session.patient.deletedAt&&!generalMedia?.deletedAt;
 };
 const archive=new ZipArchive({zlib:{level:0}});archive.on("error",()=>{});archive.on("warning",()=>archive.destroy(new Error("DOWNLOAD_FAILED")));
 request.signal.addEventListener("abort",()=>{archive.abort();archive.destroy();},{once:true});
 // Stream one remote source at a time with backpressure. No file or complete ZIP
 // is buffered on disk or in memory. Public ZIPs exclude consent audit documents.
 void(async()=>{try{for(const file of files){if(request.signal.aborted)break;if(!await canStream(file))continue;const source=(await driveStream(file.driveFileId,undefined,request.signal)).data;await new Promise<void>((resolve,reject)=>{source.once("end",resolve);source.once("error",()=>reject(new Error("DOWNLOAD_FAILED")));archive.append(source,{name:file.fileName});});}await archive.finalize();}catch{archive.destroy(new Error("DOWNLOAD_FAILED"));}})();
 return new Response(Readable.toWeb(archive) as ReadableStream,{headers:{"Content-Type":"application/zip","Content-Disposition":downloadDisposition(safe(name)+".zip"),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}catch(e){return uploadFailure(e);}}
