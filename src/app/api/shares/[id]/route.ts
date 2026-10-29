import { portalIdentity } from "@/lib/portal/access";
import { database } from "@/lib/db";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { uuid,UploadError } from "@/lib/upload/validation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const {clinic}=await portalIdentity();await jsonBody(request);const {id}=await params;if(!uuid(id))throw new UploadError("LINK_EXPIRED",404);const l=await database().shareLink.findFirst({where:{id,patient:{clinicId:clinic.id}}});if(!l)throw new UploadError("LINK_EXPIRED",404);await database().shareLink.update({where:{id},data:{revokedAt:new Date()}});return uploadResponse({ok:true});}catch(e){return uploadFailure(e);}}
