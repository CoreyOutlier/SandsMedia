import { database } from "@/lib/db";
import { portalIdentity } from "./access";
import { ticketShare } from "./shares";
import { uuid,UploadError } from "@/lib/upload/validation";
import { drive } from "@/lib/upload/drive";
import { byteRange } from "./security";
import { Readable } from "node:stream";
export async function allowedMedia(id:string,request:Request){
 if(!uuid(id))throw new UploadError("MEDIA_NOT_FOUND",404);
 const url=new URL(request.url);const ticket=url.searchParams.get("ticket");const general=url.searchParams.get("general")==="1";
 if(ticket){if(general)throw new UploadError("MEDIA_NOT_FOUND",404);const link=await ticketShare(ticket);const m=await database().media.findFirst({where:{id,session:{patientId:link.patientId,finishedAt:{not:null},consentEvents:{some:{consented:true}}}}});if(!m)throw new UploadError("MEDIA_NOT_FOUND",404);return m;}
 const {clinic}=await portalIdentity();
 const m=general?await database().generalMedia.findFirst({where:{id,generalUpload:{clinicId:clinic.id}}}):await database().media.findFirst({where:{id,session:{patient:{clinicId:clinic.id}}}});
 if(!m)throw new UploadError("MEDIA_NOT_FOUND",404);return m;
}
export async function driveStream(id:string,range?:string,signal?:AbortSignal){
 return drive().files.get({fileId:id,alt:"media",supportsAllDrives:true},{responseType:"stream",headers:range?{Range:range}:{},signal});
}
export async function mediaResponse(m:{driveFileId:string;fileName:string;bytes:bigint},action:string,request:Request){
 const api=drive();const meta=(await api.files.get({fileId:m.driveFileId,supportsAllDrives:true,fields:"mimeType,size,trashed,thumbnailLink"})).data;
 if(meta.trashed)throw new UploadError("MEDIA_NOT_FOUND",404);
 const headers=new Headers({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});
 if(action==="thumbnail"){
   if(!meta.thumbnailLink){return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#eeeeee"/><text x="400" y="300" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#666">Preview processing</text></svg>',{headers:{...Object.fromEntries(headers),"Content-Type":"image/svg+xml"}});}
   const u=new URL(meta.thumbnailLink.replace(/=s\d+/,"=s800"));
   if(u.protocol!=="https:"||!(u.hostname.endsWith(".googleusercontent.com")||u.hostname.endsWith(".google.com")))throw new UploadError("MEDIA_UNAVAILABLE",503);
   const auth=api.context._options.auth;if(!auth||typeof auth==="string")throw new UploadError("MEDIA_UNAVAILABLE",503);
   const response=await auth.request<Readable>({url:u.href,responseType:"stream",signal:request.signal});headers.set("Content-Type",response.headers.get("content-type")??"image/jpeg");
   return new Response(Readable.toWeb(response.data) as ReadableStream,{headers});
 }
 if(!["stream","download"].includes(action))throw new UploadError("MEDIA_NOT_FOUND",404);
 const size=Number(meta.size??m.bytes);let range;try{range=byteRange(request.headers.get("range"),size);}catch{return new Response(null,{status:416,headers:{...Object.fromEntries(headers),"Content-Range":`bytes */${size}`}});}
 const response=await driveStream(m.driveFileId,range?`bytes=${range.start}-${range.end}`:undefined,request.signal);
 headers.set("Content-Type",meta.mimeType??"application/octet-stream");headers.set("Accept-Ranges","bytes");headers.set("Content-Length",String(range?range.end-range.start+1:size));
 if(range)headers.set("Content-Range",`bytes ${range.start}-${range.end}/${size}`);
 if(action==="download")headers.set("Content-Disposition",`attachment; filename="${m.fileName.replace(/[^a-zA-Z0-9_.-]/g,"_")}"`);
 return new Response(Readable.toWeb(response.data) as ReadableStream,{status:range?206:200,headers});
}
