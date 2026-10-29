import { database } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, validateConsentVersion } from "@/lib/consent";
import { ensureFolder, getDriveFile, mintUpload, reserveFileId, writeConsentFile, appendConsentMirror } from "./drive";
import { FilePlan, UploadError, folderName, patientFolderName, validateStart } from "./validation";
import { seal, unseal } from "./security";
import { uploadIdentity } from "./http";
import { isIP } from "node:net";
type Identity=Awaited<ReturnType<typeof uploadIdentity>>;
type Tx=Prisma.TransactionClient;
const include={session:{include:{patient:true}},generalUpload:true} as const;
async function lock(tx:Tx,key:string) {await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;}
async function ownedBatch(tx:Tx,id:string,identity:Identity,lockPatient=false) {
  const batch=await tx.uploadBatch.findUnique({where:{id},include});
  if(!batch || batch.clinicId!==identity.clinic.id || batch.principalHash!==identity.principalHash) throw new UploadError("UPLOAD_NOT_FOUND",404);
  if(batch.session){
    if(lockPatient){
      await lock(tx,`patient:${batch.session.patientId}`);
      // Re-read after the shared patient lock: archive/withdraw may have won
      // while this upload request was waiting for its batch lock.
      batch.session.patient=await tx.patient.findUniqueOrThrow({where:{id:batch.session.patientId}});
    }
    if(batch.session.patient.archivedAt)throw new UploadError("PATIENT_ARCHIVED",409);
    if(lockPatient&&batch.session.patient.consentWithdrawnAt)throw new UploadError("CONSENT_WITHDRAWN",409);
  }
  return batch;
}
function payload(batch:Awaited<ReturnType<typeof ownedBatch>>) {
  const item=batch.session??batch.generalUpload!;
  return {id:batch.id,general:!!batch.generalUpload,finished:!!item.finishedAt,date:item.date.toISOString().slice(0,10),title:batch.session?.treatment??batch.generalUpload!.title,description:item.description,uploadedBy:item.uploadedBy,consented:batch.consented,formOnFile:batch.formOnFile,patient:batch.session?{id:batch.session.patient.id,firstName:batch.session.patient.firstName,lastName:batch.session.patient.lastName,displayId:batch.session.patient.displayId}:null,files:(batch.manifest as unknown as FilePlan[]).map(({encryptedUrl,...file})=>file)};
}
export async function getBatch(id:string,identity:Identity) { return payload(await ownedBatch(database(),id,identity)); }
export async function startBatch(raw:unknown,identity:Identity) {
  const data=validateStart(raw,Number(process.env.MAX_VIDEO_MB??500));
  if(!validateConsentVersion(process.env.CONSENT_TEXT_VERSION)) throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
  return database().$transaction(async tx=>{
    await lock(tx,`start:${identity.clinic.id}`);
    const existing=await tx.uploadBatch.findUnique({where:{id:data.uploadId}});
    if(existing) return payload(await ownedBatch(tx,data.uploadId,identity,true));
    let sessionId:string|null=null; let generalUploadId:string|null=null;
    if(data.general) {
      const u=await tx.generalUpload.create({data:{uploadId:data.uploadId,clinicId:identity.clinic.id,title:data.title,description:data.description,uploadedBy:data.uploadedBy,date:new Date(data.date)}}); generalUploadId=u.id;
    } else {
      if(data.patientId)await lock(tx,`patient:${data.patientId}`);
      let patient=data.patientId?await tx.patient.findFirst({where:{id:data.patientId,clinicId:identity.clinic.id}}):null;
      if(data.patientId && !patient) throw new UploadError("PATIENT_NOT_FOUND",404);
      if(!patient) {
        const c=await tx.clinic.update({where:{id:identity.clinic.id},data:{nextPatientNumber:{increment:1}}});
        patient=await tx.patient.create({data:{clinicId:c.id,displayId:`DS-${String(c.nextPatientNumber-1).padStart(4,"0")}`,firstName:data.firstName,lastName:data.lastName}});
      }
      if(patient.archivedAt) throw new UploadError("PATIENT_ARCHIVED",409);
      if(patient.consentWithdrawnAt) throw new UploadError("CONSENT_WITHDRAWN",409);
      const s=await tx.session.create({data:{uploadId:data.uploadId,patientId:patient.id,treatment:data.title,description:data.description,uploadedBy:data.uploadedBy,date:new Date(data.date)}}); sessionId=s.id;
    }
    const batch=await tx.uploadBatch.create({data:{id:data.uploadId,clinicId:identity.clinic.id,sessionId,generalUploadId,principalHash:identity.principalHash,consented:data.consented,formOnFile:data.formOnFile,manifest:data.files as unknown as Prisma.InputJsonValue},include});
    return payload(batch);
  },{timeout:15000});
}
async function provision(tx:Tx,batch:Awaited<ReturnType<typeof ownedBatch>>,identity:Identity) {
  const root=identity.clinic.driveRootFolderId;
  if(root!==process.env.DRIVE_ROOT_FOLDER_ID) throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
  let sessionFolder=batch.session?.driveFolderId??batch.generalUpload?.driveFolderId;
  if(!sessionFolder) {
    await lock(tx,`folders:${identity.clinic.id}`);
    const library=await ensureFolder(root,batch.session?"Patients":"Other uploads",batch.session?"patients":"general",true);
    const item=batch.session??batch.generalUpload!;
    const title=batch.session?.treatment??batch.generalUpload!.title;
    const dated=`${item.date.toISOString().slice(0,10)} ${folderName(title)}${batch.session?"":` – ${batch.id.slice(0,8)}`}`;
    let parent=library;
    if(batch.session) {
      const p=await tx.patient.findUniqueOrThrow({where:{id:batch.session.patientId}});
      parent=p.driveFolderId??await ensureFolder(library,patientFolderName(p.firstName,p.lastName,p.displayId),`patient:${p.id}`);
      if(!p.driveFolderId) await tx.patient.update({where:{id:p.id},data:{driveFolderId:parent}});
    }
    sessionFolder=await ensureFolder(parent,dated,`batch:${batch.id}`,false,batch.session?batch.id.slice(0,8):undefined);
    if(batch.session) await tx.session.update({where:{id:batch.session.id},data:{driveFolderId:sessionFolder}});
    else await tx.generalUpload.update({where:{id:batch.generalUpload!.id},data:{driveFolderId:sessionFolder}});
  }
  const photos=batch.photosFolderId??await ensureFolder(sessionFolder,"Photos",`photos:${batch.id}`);
  const videos=batch.videosFolderId??await ensureFolder(sessionFolder,"Videos",`videos:${batch.id}`);
  await tx.uploadBatch.update({where:{id:batch.id},data:{photosFolderId:photos,videosFolderId:videos}});
  return {photos,videos,sessionFolder};
}
export async function signFile(id:string,key:string,identity:Identity) {
  return database().$transaction(async tx=>{
    await lock(tx,`batch:${id}`); const batch=await ownedBatch(tx,id,identity,true);
    if((batch.session??batch.generalUpload!).finishedAt) throw new UploadError("UPLOAD_FINISHED",409);
    if(batch.session?.patient.consentWithdrawnAt) throw new UploadError("CONSENT_WITHDRAWN",409);
    const files=batch.manifest as unknown as FilePlan[]; const file=files.find(f=>f.key===key); if(!file)throw new UploadError("FILE_NOT_FOUND",404);
    const dirs=await provision(tx,batch,identity); const parent=file.kind==="photo"?dirs.photos:dirs.videos;
    if(!file.driveId) file.driveId=await reserveFileId();
    const existing=await getDriveFile(file.driveId);
    if(existing) return {driveId:file.driveId,complete:true};
    // Reuse one authorized session URI for network retries. For expired sessions,
    // a later call may request a new URI for the same preallocated Drive file ID.
    if(!file.encryptedUrl) file.encryptedUrl=seal(await mintUpload(file.driveId,parent,file.name,file.mimeType,file.bytes,`file:${id}:${key}`));
    await tx.uploadBatch.update({where:{id},data:{manifest:files as unknown as Prisma.InputJsonValue}});
    return {driveId:file.driveId,url:unseal(file.encryptedUrl),complete:false};
  },{timeout:60000,maxWait:10000});
}
export async function confirmFile(id:string,key:string,identity:Identity) {
  return database().$transaction(async tx=>{
    await lock(tx,`batch:${id}`); const batch=await ownedBatch(tx,id,identity,true);
    const files=batch.manifest as unknown as FilePlan[]; const file=files.find(f=>f.key===key); if(!file?.driveId) throw new UploadError("FILE_NOT_FOUND",404);
    if(file.confirmed) return {confirmed:true};
    const actual=await getDriveFile(file.driveId); const expectedParent=file.kind==="photo"?batch.photosFolderId:batch.videosFolderId;
    if(!actual || actual.trashed || !actual.parents?.includes(expectedParent??"") || actual.appProperties?.postingCenterKey!==`file:${id}:${key}` || actual.mimeType!==file.mimeType || actual.name!==file.name || Number(actual.size)!==file.bytes) throw new UploadError("FILE_NOT_CONFIRMED",409);
    const image=actual.imageMediaMetadata;
    if(file.kind==="photo" && (!image?.width || !image.height || Math.max(image.width,image.height)>2048)) throw new UploadError("FILE_NOT_CONFIRMED",409);
    const meta=actual.videoMediaMetadata; if(file.kind==="video" && meta?.durationMillis && Number(meta.durationMillis)>180000) throw new UploadError("VIDEO_TOO_LONG");
    const common={driveFileId:file.driveId,fileName:file.name,title:file.title??null,kind:file.kind,position:files.indexOf(file),bytes:BigInt(file.bytes),width:file.width,height:file.height,durationS:file.durationS};
    if(batch.sessionId) await tx.media.create({data:{...common,sessionId:batch.sessionId,label:file.label}});
    else await tx.generalMedia.create({data:{...common,generalUploadId:batch.generalUploadId!}});
    file.confirmed=true; delete file.encryptedUrl;
    await tx.uploadBatch.update({where:{id},data:{manifest:files as unknown as Prisma.InputJsonValue}});
    return {confirmed:true};
  },{timeout:30000});
}
export async function renewFile(id:string,key:string,identity:Identity) {
  await database().$transaction(async tx=>{await lock(tx,`batch:${id}`); const batch=await ownedBatch(tx,id,identity,true); const files=batch.manifest as unknown as FilePlan[]; const f=files.find(f=>f.key===key); if(!f)throw new UploadError("FILE_NOT_FOUND",404); delete f.encryptedUrl; await tx.uploadBatch.update({where:{id},data:{manifest:files as unknown as Prisma.InputJsonValue}});});
}
export async function finishBatch(id:string,identity:Identity,request:Request) {
  // Commit the immutable event before copying it to Drive. A network failure must
  // not leave a Drive consent file referring to a rolled-back event.
  await database().$transaction(async tx=>{
    await lock(tx,`batch:${id}`);const batch=await ownedBatch(tx,id,identity,true);
    const files=batch.manifest as unknown as FilePlan[];
    if(!files.every(f=>f.confirmed))throw new UploadError("UPLOAD_INCOMPLETE",409);
    if(batch.session?.patient.consentWithdrawnAt)throw new UploadError("CONSENT_WITHDRAWN",409);
    if(batch.session && batch.consented && !await tx.consentEvent.findFirst({where:{sessionId:batch.session.id,renewalId:null}})){
      const address=request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()??"";
      await tx.consentEvent.create({data:{sessionId:batch.session.id,consented:true,formOnFile:batch.formOnFile,consentText:CONSENT_TEXT,consentTextVersion:CONSENT_TEXT_VERSION,consentedBy:batch.session.uploadedBy,ip:isIP(address)?address:"0.0.0.0",userAgent:(request.headers.get("user-agent")??"unknown").slice(0,500)}});
    }
  });
  return database().$transaction(async tx=>{
    await lock(tx,`batch:${id}`); const batch=await ownedBatch(tx,id,identity,true); const item=batch.session??batch.generalUpload!;
    const files=batch.manifest as unknown as FilePlan[];
    if(!files.every(f=>f.confirmed) || !item.driveFolderId) throw new UploadError("UPLOAD_INCOMPLETE",409);
    if(batch.session?.patient.consentWithdrawnAt) throw new UploadError("CONSENT_WITHDRAWN",409);
    if(batch.session && batch.consented) {
      const event=await tx.consentEvent.findFirstOrThrow({where:{sessionId:batch.session.id,renewalId:null}});
      await writeConsentFile(item.driveFolderId,event.id,{eventId:event.id,patientId:batch.session.patient.displayId,sessionDate:item.date.toISOString().slice(0,10),consentText:event.consentText,consentTextVersion:event.consentTextVersion,consentedBy:event.consentedBy,formOnFile:event.formOnFile,timestamp:event.createdAt.toISOString(),ip:event.ip,userAgent:event.userAgent});
      await lock(tx,`consent-mirror:${identity.clinic.id}`);
      await appendConsentMirror(identity.clinic.driveRootFolderId,event.id,[batch.session.patient.displayId,item.date.toISOString().slice(0,10),String(event.consentTextVersion),event.consentText,event.consentedBy,String(event.formOnFile),event.createdAt.toISOString(),event.ip,event.userAgent]);
    }
    if(!item.finishedAt) {
      if(batch.session) await tx.session.update({where:{id:item.id},data:{finishedAt:new Date(),status:batch.consented?"ready":"hold"}});
      else await tx.generalUpload.update({where:{id:item.id},data:{finishedAt:new Date()}});
    }
    const folder=await getDriveFile(item.driveFolderId);
    if(!folder?.name || folder.trashed)throw new UploadError("DRIVE_UNAVAILABLE",503);
    const patient=batch.session?.patient;
    return {saved:true,count:files.length,consented:batch.consented,general:!!batch.generalUpload,patientId:patient?.id,driveUrl:`https://drive.google.com/drive/folders/${item.driveFolderId}`,path:`Posting Center / ${patient?`Patients / ${patientFolderName(patient.firstName,patient.lastName,patient.displayId)}`:"Other uploads"} / ${folder.name}`};
  },{timeout:60000});
}
