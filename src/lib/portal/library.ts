import { database } from "@/lib/db";
import { clearance } from "@/lib/clearance";
import { Prisma } from "@/generated/prisma/client";
import { UploadError, textField, uuid } from "@/lib/upload/validation";
export const patientInclude = { sessions: { orderBy: [{date:"desc"},{createdAt:"desc"}], include: { media: { orderBy: {position:"asc"} }, consentEvents: { select: {consented:true,formOnFile:true,createdAt:true,consentTextVersion:true} } } } } satisfies Prisma.PatientInclude;
export function mediaDto(m: {id:string;kind:string;fileName:string;bytes:bigint;width:number|null;height:number|null;durationS:number|null;position:number;label?:string}, general=false, ticket?:string) {
  const query = new URLSearchParams(); if(general)query.set("general","1");if(ticket)query.set("ticket",ticket);
  const suffix=query.size?`?${query}`:"";
  return {id:m.id,kind:m.kind,label:m.label??"other",bytes:Number(m.bytes),width:m.width,height:m.height,durationS:m.durationS,position:m.position,thumbnail:`/api/media/${m.id}/thumbnail${suffix}`,stream:`/api/media/${m.id}/stream${suffix}`,download:`/api/media/${m.id}/download${suffix}`};
}
export async function patientDetail(id:string,clinicId:string) {
  if(!uuid(id))throw new UploadError("PATIENT_NOT_FOUND",404);
  const p=await database().patient.findFirst({where:{id,clinicId},include:patientInclude});
  if(!p)throw new UploadError("PATIENT_NOT_FOUND",404);
  const status=clearance(p);
  const links=await database().shareLink.findMany({where:{patientId:id},orderBy:{createdAt:"desc"},take:50,select:{id:true,createdAt:true,expiresAt:true,revokedAt:true,viewCount:true,lastViewedAt:true,pinHash:true,views:{take:10,orderBy:{createdAt:"desc"},select:{id:true,createdAt:true}}}});
  return {id:p.id,name:`${p.firstName} ${p.lastName}`,displayId:p.displayId,clearance:status,driveUrl:p.driveFolderId?`https://drive.google.com/drive/folders/${p.driveFolderId}`:null,download:`/api/download/patient/${p.id}`,sessions:p.sessions.map(s=>({id:s.id,date:s.date.toISOString().slice(0,10),title:s.treatment,description:s.description,uploadedBy:s.uploadedBy,status:s.status,finished:!!s.finishedAt,consented:s.consentEvents.some(e=>e.consented),formOnFile:s.consentEvents.some(e=>e.consented&&e.formOnFile),quote:s.testimonialQuote,media:s.media.map(m=>mediaDto(m))})),links:links.map(({pinHash,views,...l})=>({...l,pinProtected:!!pinHash,views})),postedSessions:p.sessions.filter(s=>s.status==="posted").map(s=>({id:s.id,title:s.treatment,date:s.date.toISOString().slice(0,10)}))};
}
export async function generalDetail(id:string,clinicId:string) {
  if(!uuid(id))throw new UploadError("UPLOAD_NOT_FOUND",404);
  const u=await database().generalUpload.findFirst({where:{id,clinicId},include:{media:{orderBy:{position:"asc"}}}});
  if(!u)throw new UploadError("UPLOAD_NOT_FOUND",404);
  return {id:u.id,name:u.title,displayId:"Other uploads",driveUrl:u.driveFolderId?`https://drive.google.com/drive/folders/${u.driveFolderId}`:null,download:`/api/download/general/${u.id}`,sessions:[{id:u.id,date:u.date.toISOString().slice(0,10),title:u.title,description:u.description,uploadedBy:u.uploadedBy,status:"private",finished:!!u.finishedAt,consented:false,media:u.media.map(m=>mediaDto(m,true))}],links:[],postedSessions:[]};
}
export async function listLibrary(body:Record<string,unknown>,clinicId:string) {
  const q=textField(body.q??"",120,false);const kind=["photo","video"].includes(String(body.media))?String(body.media):"all";
  const filter=String(body.filter??"all");const general=body.general===true;
  const offset=Number(body.offset??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new UploadError("INVALID_FIELDS");
  const pattern=(v:string)=>`%${v.replace(/[\\%_]/g,"\\$&")}%`;
  type Result={id:string;name:string;display_id:string;date:Date;photos:bigint;videos:bigint;status:string;posted:bigint;incomplete:boolean};
  let rows:Result[];
  if(general){const match=q.length>=2?Prisma.sql`AND (u.title ILIKE ${pattern(q)} OR u.description ILIKE ${pattern(q)})`:Prisma.empty;
    rows=await database().$queryRaw<Result[]>(Prisma.sql`
      SELECT u.id,u.title AS name,'Other uploads' AS display_id,u.date,
      (SELECT count(*) FROM general_media m WHERE m.general_upload_id=u.id AND m.kind='photo') AS photos,
      (SELECT count(*) FROM general_media m WHERE m.general_upload_id=u.id AND m.kind='video') AS videos,
      'private' AS status,0::bigint AS posted,u.finished_at IS NULL AS incomplete
      FROM general_uploads u WHERE u.clinic_id=${clinicId}::uuid ${match}
      AND (${kind}='all' OR EXISTS(SELECT 1 FROM general_media m WHERE m.general_upload_id=u.id AND m.kind::text=${kind}))
      ORDER BY u.date DESC,u.created_at DESC,u.id LIMIT 51 OFFSET ${offset}`);
  }else{
    const terms=q.length>=2?q.split(/\s+/).filter(Boolean).map(word=>{const like=pattern(word);return Prisma.sql`(p.first_name ILIKE ${like} OR p.last_name ILIKE ${like} OR p.display_id ILIKE ${like} OR EXISTS(SELECT 1 FROM sessions t WHERE t.patient_id=p.id AND t.treatment ILIKE ${like}))`;}):[];
    const match=terms.length?Prisma.sql`AND ${Prisma.join(terms," AND ")}`:Prisma.empty;
    rows=await database().$queryRaw<Result[]>(Prisma.sql`
      WITH candidates AS (
        SELECT p.id,p.first_name||' '||p.last_name AS name,p.display_id,
        COALESCE((SELECT max(s.date) FROM sessions s WHERE s.patient_id=p.id),p.created_at) AS date,
        (SELECT count(*) FROM media m JOIN sessions s ON s.id=m.session_id WHERE s.patient_id=p.id AND m.kind='photo') AS photos,
        (SELECT count(*) FROM media m JOIN sessions s ON s.id=m.session_id WHERE s.patient_id=p.id AND m.kind='video') AS videos,
        (SELECT count(*) FROM sessions s WHERE s.patient_id=p.id AND s.status='posted') AS posted,
        EXISTS(SELECT 1 FROM sessions s WHERE s.patient_id=p.id AND s.finished_at IS NULL) AS incomplete,
        CASE WHEN p.consent_withdrawn_at IS NOT NULL THEN 'withdrawn'
        WHEN NOT EXISTS(SELECT 1 FROM sessions s WHERE s.patient_id=p.id) OR EXISTS(SELECT 1 FROM sessions s WHERE s.patient_id=p.id AND (s.finished_at IS NULL OR NOT EXISTS(SELECT 1 FROM consent_events c WHERE c.session_id=s.id AND c.consented))) THEN 'hold' ELSE 'cleared' END AS status
        FROM patients p WHERE p.clinic_id=${clinicId}::uuid ${match}
      ) SELECT * FROM candidates WHERE
      (${kind}='all' OR (${kind}='photo' AND photos>0) OR (${kind}='video' AND videos>0)) AND
      (${filter}='all' OR (${filter}='cleared' AND status='cleared') OR (${filter}='hold' AND status<>'cleared') OR (${filter}='posted' AND status='cleared' AND posted>0))
      ORDER BY date DESC,id LIMIT 51 OFFSET ${offset}`);
  }
  return {more:rows.length>50,rows:rows.slice(0,50).map(r=>({id:r.id,name:r.name,displayId:r.display_id,date:r.date.toISOString(),photos:Number(r.photos),videos:Number(r.videos),status:r.status,posted:Number(r.posted),incomplete:r.incomplete}))};
}
