import { eligibleAnonymousMedia, type AnonymousApprovalState, type AnonymousPatientState } from "../anonymous-use.ts";

type PostingMedia = {id:string;kind:string;anonymousUseVersion:number;deletedAt?:unknown;useEvents:AnonymousApprovalState[]};
type PostingSession = {finishedAt:unknown;consentEvents:{consented:boolean}[];media:PostingMedia[]};

// Readiness belongs to this finished upload. An anonymous approval never clears
// another photo, a video, or a patient-bearing share page.
export function sessionOnlineReady(patient:AnonymousPatientState,session:PostingSession){
  if(patient.deletedAt||patient.archivedAt||patient.consentWithdrawnAt||!session.finishedAt)return false;
  const media=session.media.filter(m=>!m.deletedAt);
  if(!media.length)return false;
  return session.consentEvents.some(e=>e.consented)||media.every(m=>eligibleAnonymousMedia(m,m.useEvents[0],patient,session));
}
