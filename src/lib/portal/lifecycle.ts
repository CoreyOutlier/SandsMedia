import { database } from "@/lib/db";
import { CONSENT_TEXT,CONSENT_TEXT_VERSION,validateConsentVersion } from "@/lib/consent";
import { clearance } from "@/lib/clearance";
import { patientInclude } from "./library";
import { portalIdentity,requestIdentity } from "./access";
import { canCompleteRenewal } from "./lifecycle-policy";
import { appendConsentMirrors,writeConsentFile } from "@/lib/upload/drive";
import { UploadError,uuid } from "@/lib/upload/validation";
type Identity=Awaited<ReturnType<typeof portalIdentity>>;

export async function patientAction(id:string,identity:Identity,body:Record<string,unknown>,request:Request){
 if(body.action==="renew_consent")return renewConsent(id,identity,body,request);
 await database().$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${id}`}))`;
  const p=await tx.patient.findFirst({where:{id,clinicId:identity.clinic.id}});
  if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);
  let action:string|null=null;
  if(body.action==="withdraw"){
   const pending=await tx.patientActivity.findFirst({where:{patientId:id,action:"renewal_recorded",patientVersion:p.lifecycleVersion}});
   if(!p.consentWithdrawnAt||pending){await tx.patient.update({where:{id},data:{consentWithdrawnAt:p.consentWithdrawnAt??new Date(),lifecycleVersion:{increment:1}}});action="consent_withdrawn";}
   await tx.shareLink.updateMany({where:{patientId:id,revokedAt:null},data:{revokedAt:new Date()}});
  }else if(body.action==="archive"){
   if(!p.archivedAt){await tx.patient.update({where:{id},data:{archivedAt:new Date(),lifecycleVersion:{increment:1}}});action="archived";}
   await tx.shareLink.updateMany({where:{patientId:id,revokedAt:null},data:{revokedAt:new Date()}});
  }else if(body.action==="restore"){
   if(p.archivedAt){await tx.patient.update({where:{id},data:{archivedAt:null,lifecycleVersion:{increment:1}}});action="restored";}
  }else if(body.action==="status"&&uuid(body.sessionId)&&["ready","posted"].includes(String(body.status))){
   const current=await tx.patient.findUniqueOrThrow({where:{id},include:patientInclude});
   if(clearance(current).status!=="cleared"||!current.sessions.some(s=>s.id===body.sessionId))throw new UploadError("CONSENT_REQUIRED",409);
   await tx.session.update({where:{id:body.sessionId},data:{status:body.status as "ready"|"posted"}});
  }else throw new UploadError("INVALID_FIELDS");
  if(action)await tx.patientActivity.create({data:{patientId:id,action,actor:identity.email,patientVersion:p.lifecycleVersion+1}});
 },{maxWait:10000,timeout:20000});
}

async function renewConsent(id:string,identity:Identity,body:Record<string,unknown>,request:Request){
 if(body.confirmed!==true||!uuid(body.requestId))throw new UploadError("INVALID_CONSENT");
 if(!validateConsentVersion(process.env.CONSENT_TEXT_VERSION)||identity.clinic.driveRootFolderId!==process.env.DRIVE_ROOT_FOLDER_ID)throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
 const operationId=body.requestId;
 // Persist immutable consent first. Keep withdrawal in force until every copy
 // reaches Drive; retries reuse the same operation and the same consent events.
 const prepared=await database().$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${id}`}))`;
  const p=await tx.patient.findFirst({where:{id,clinicId:identity.clinic.id},include:{sessions:{where:{finishedAt:{not:null}}}}});
  if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);
  const old=await tx.patientActivity.findUnique({where:{id:operationId}});
  if(old){
   if(old.patientId!==id||old.action!=="renewal_recorded")throw new UploadError("INVALID_FIELDS");
   const completed=await tx.patientActivity.findUnique({where:{operationId_action:{operationId,action:"consent_renewed"}}});
   if(completed){
    if(p.archivedAt||p.consentWithdrawnAt||p.lifecycleVersion!==completed.patientVersion)throw new UploadError("CONSENT_RENEWAL_STALE",409);
    return {done:true,version:old.patientVersion};
   }
   if(!canCompleteRenewal(p,old.patientVersion))throw new UploadError("CONSENT_RENEWAL_STALE",409);
   return {done:false,version:old.patientVersion};
  }
  if(p.archivedAt)throw new UploadError("PATIENT_ARCHIVED",409);
  if(!p.consentWithdrawnAt)throw new UploadError("CONSENT_NOT_WITHDRAWN",409);
  if(!p.sessions.length)throw new UploadError("NO_COMPLETED_SESSIONS",409);
  if(p.sessions.some(s=>!s.driveFolderId))throw new UploadError("UPLOAD_INCOMPLETE",409);
  const version=p.lifecycleVersion+1;
  await tx.patient.update({where:{id},data:{lifecycleVersion:version}});
  await tx.patientActivity.create({data:{id:operationId,patientId:id,action:"renewal_recorded",actor:identity.email,operationId,patientVersion:version}});
  const source=requestIdentity(request);
  await tx.consentEvent.createMany({data:p.sessions.map(s=>({sessionId:s.id,renewalId:operationId,consented:true,formOnFile:true,consentText:CONSENT_TEXT,consentTextVersion:CONSENT_TEXT_VERSION,consentedBy:identity.email,...source}))});
  return {done:false,version};
 },{maxWait:10000,timeout:20000});
 if(prepared.done)return;
 const patient=await database().patient.findUniqueOrThrow({where:{id},select:{displayId:true}});
 const events=await database().consentEvent.findMany({where:{renewalId:operationId},include:{session:{select:{id:true,date:true,driveFolderId:true}}},orderBy:{id:"asc"}});
 for(let offset=0;offset<events.length;offset+=4){
  await Promise.all(events.slice(offset,offset+4).map(e=>database().$transaction(async tx=>{
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consent-file:${e.id}`}))`;
   await writeConsentFile(e.session.driveFolderId!,e.id,{eventId:e.id,renewalId:operationId,patientId:patient.displayId,sessionDate:e.session.date.toISOString().slice(0,10),consentText:e.consentText,consentTextVersion:e.consentTextVersion,consentedBy:e.consentedBy,formOnFile:e.formOnFile,timestamp:e.createdAt.toISOString(),ip:e.ip,userAgent:e.userAgent},true);
  },{maxWait:10000,timeout:60000})));
 }
 // The shared clinic CSV uses the same lock as initial-upload consent mirrors.
 await database().$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consent-mirror:${identity.clinic.id}`}))`;
  await appendConsentMirrors(identity.clinic.driveRootFolderId,events.map(e=>({eventId:e.id,values:[patient.displayId,e.session.date.toISOString().slice(0,10),String(e.consentTextVersion),e.consentText,e.consentedBy,String(e.formOnFile),e.createdAt.toISOString(),e.ip,e.userAgent]})));
 },{maxWait:10000,timeout:60000});
 await database().$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${id}`}))`;
  const p=await tx.patient.findUniqueOrThrow({where:{id}});
  const completed=await tx.patientActivity.findUnique({where:{operationId_action:{operationId,action:"consent_renewed"}}});
  if(completed){
   if(p.archivedAt||p.consentWithdrawnAt||p.lifecycleVersion!==completed.patientVersion)throw new UploadError("CONSENT_RENEWAL_STALE",409);
   return;
  }
  if(!canCompleteRenewal(p,prepared.version))throw new UploadError("CONSENT_RENEWAL_STALE",409);
  await tx.patient.update({where:{id},data:{consentWithdrawnAt:null,lifecycleVersion:{increment:1}}});
  await tx.session.updateMany({where:{id:{in:events.map(e=>e.sessionId)},status:"hold"},data:{status:"ready"}});
  await tx.patientActivity.create({data:{patientId:id,action:"consent_renewed",actor:identity.email,operationId,patientVersion:prepared.version+1}});
  // No ShareLink update: links revoked by withdrawal remain revoked forever.
 },{maxWait:10000,timeout:20000});
}
