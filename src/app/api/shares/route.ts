import { hash } from "bcryptjs";
import { database } from "@/lib/db";
import { portalIdentity,rateLimit } from "@/lib/portal/access";
import { newToken,hashToken,signTicket } from "@/lib/portal/security";
import { clearance } from "@/lib/clearance";
import { patientInclude } from "@/lib/portal/library";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { uuid,UploadError } from "@/lib/upload/validation";
export async function POST(request:Request){try{
 const {clinic,email}=await portalIdentity();const b=await jsonBody(request);if(!uuid(b.patientId)||![1,7,30].includes(b.days??7)||b.pin&&!/^\d{4}$/.test(b.pin))throw new UploadError("INVALID_FIELDS");
 await rateLimit(`share-create:${clinic.id}`,request,30);
 // Fail before creating a link if signing has not been configured.
 signTicket({expires:Date.now()+1000},"setup");
 const token=newToken();const pinHash=b.pin?await hash(b.pin,12):null;
 await database().$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${b.patientId}`}))`;
   const p=await tx.patient.findFirst({where:{id:b.patientId,clinicId:clinic.id},include:patientInclude});
   if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);if(clearance(p).status!=="cleared")throw new UploadError("CONSENT_REQUIRED",409);
   await tx.shareLink.create({data:{patientId:p.id,tokenHash:hashToken(token),pinHash,createdBy:email,expiresAt:new Date(Date.now()+(b.days??7)*86400000)}});
 });return uploadResponse({url:new URL(`/s/${token}`,process.env.APP_URL).href,days:b.days??7});
}catch(e){return uploadFailure(e);}}
