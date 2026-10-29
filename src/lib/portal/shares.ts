import { cookies } from "next/headers";
import { database } from "@/lib/db";
import { activeLink,hashToken,readTicket,validToken,signTicket } from "./security";
import { patientInclude,mediaDto } from "./library";
import { UploadError } from "@/lib/upload/validation";
export async function findShare(token:string) {
  if(!validToken(token))return null;
  const link=await database().shareLink.findUnique({where:{tokenHash:hashToken(token)},include:{patient:{include:{...patientInclude,clinic:{select:{name:true}}}}}});
  return link&&activeLink(link)?link:null;
}
export async function pinUnlocked(link:{id:string;pinHash:string|null}) {
  if(!link.pinHash)return true;
  const data=readTicket((await cookies()).get(`pc-pin-${link.id}`)?.value,"pin");
  return data?.shareId===link.id&&data?.version===hashToken(link.pinHash);
}
export async function requireShare(token:string) {const link=await findShare(token);if(!link)throw new UploadError("LINK_EXPIRED",404);if(!await pinUnlocked(link))throw new UploadError("PIN_REQUIRED",401);return link;}
export function shareTicket(shareId:string) {return signTicket({shareId,expires:Date.now()+15*60000},"media");}
export async function shareData(token:string) {
  const link=await requireShare(token);const p=link.patient;const ticket=shareTicket(link.id);
  const visible=p.sessions.filter(s=>s.finishedAt&&s.consentEvents.some(e=>e.consented));
  return {name:`${p.firstName} ${p.lastName.slice(0,1)}.`,displayId:p.displayId,expiresAt:link.expiresAt.toISOString(),hidden:p.sessions.length-visible.length,download:`/api/download/share/${link.id}?ticket=${encodeURIComponent(ticket)}`,sessions:visible.map(s=>({id:s.id,date:s.date.toISOString().slice(0,10),title:s.treatment,quote:s.testimonialQuote,media:s.media.map(m=>mediaDto(m,false,ticket))}))};
}
export async function ticketShare(ticket:string|null) {
  const data=readTicket(ticket,"media");if(typeof data?.shareId!=="string")throw new UploadError("LINK_EXPIRED",403);
  const link=await database().shareLink.findUnique({where:{id:data.shareId},include:{patient:true}});
  if(!link||!activeLink(link))throw new UploadError("LINK_EXPIRED",403);return link;
}
