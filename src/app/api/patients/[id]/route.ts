import { portalIdentity } from "@/lib/portal/access";
import { patientDetail,patientInclude } from "@/lib/portal/library";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { database } from "@/lib/db";
import { clearance } from "@/lib/clearance";
import { UploadError,uuid } from "@/lib/upload/validation";
type Context={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Context){try{const {clinic}=await portalIdentity();return uploadResponse(await patientDetail((await params).id,clinic.id));}catch(e){return uploadFailure(e);}}
export async function POST(request:Request,{params}:Context){try{
  const {clinic}=await portalIdentity();const {id}=await params;if(!uuid(id))throw new UploadError("PATIENT_NOT_FOUND",404);const body=await jsonBody(request);
  await database().$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${id}`}))`;
    const p=await tx.patient.findFirst({where:{id,clinicId:clinic.id},include:patientInclude});if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);
    if(body.action==="withdraw"){
      if(!p.consentWithdrawnAt)await tx.patient.update({where:{id},data:{consentWithdrawnAt:new Date()}});
      await tx.shareLink.updateMany({where:{patientId:id,revokedAt:null},data:{revokedAt:new Date()}});
    }else if(body.action==="status"&&uuid(body.sessionId)&&["ready","posted"].includes(body.status)){
      if(clearance(p).status!=="cleared"||!p.sessions.some(s=>s.id===body.sessionId))throw new UploadError("CONSENT_REQUIRED",409);
      await tx.session.update({where:{id:body.sessionId},data:{status:body.status}});
    }else throw new UploadError("INVALID_FIELDS");
  });return uploadResponse(await patientDetail(id,clinic.id));
}catch(e){return uploadFailure(e);}}
