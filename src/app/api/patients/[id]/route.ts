import { portalIdentity } from "@/lib/portal/access";
import { patientDetail,patientInclude } from "@/lib/portal/library";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { database } from "@/lib/db";
import { clearance } from "@/lib/clearance";
import { UploadError,uuid } from "@/lib/upload/validation";
export const maxDuration=60;
type Context={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Context){try{const {clinic}=await portalIdentity();return uploadResponse(await patientDetail((await params).id,clinic.id));}catch(e){return uploadFailure(e);}}
export async function POST(request:Request,{params}:Context){try{
  const {clinic}=await portalIdentity();const {id}=await params;if(!uuid(id))throw new UploadError("PATIENT_NOT_FOUND",404);const body=await jsonBody(request);
  await database().$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${id}`}))`;
    if(body.action==="withdraw"){
      const p=await tx.patient.findFirst({where:{id,clinicId:clinic.id},select:{id:true,consentWithdrawnAt:true}});if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);
      if(!p.consentWithdrawnAt)await tx.patient.update({where:{id},data:{consentWithdrawnAt:new Date()}});
      await tx.shareLink.updateMany({where:{patientId:id,revokedAt:null},data:{revokedAt:new Date()}});
    }else if(body.action==="status"&&uuid(body.sessionId)&&["ready","posted"].includes(body.status)){
      const p=await tx.patient.findFirst({where:{id,clinicId:clinic.id},include:patientInclude});if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);
      if(clearance(p).status!=="cleared"||!p.sessions.some(s=>s.id===body.sessionId))throw new UploadError("CONSENT_REQUIRED",409);
      await tx.session.update({where:{id:body.sessionId},data:{status:body.status}});
    }else throw new UploadError("INVALID_FIELDS");
  },{maxWait:10000,timeout:15000});const result=await patientDetail(id,clinic.id);return uploadResponse(result);
 }catch(e){
 if(!(e instanceof UploadError)){const code=(e as {code?:unknown})?.code;console.error(typeof code==="string"&&/^P\d{4}$/.test(code)?`PATIENT_ACTION_${code}`:"PATIENT_ACTION_FAILED");}
 return uploadFailure(e);}}
