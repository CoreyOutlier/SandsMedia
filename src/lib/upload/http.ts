import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/access";
import { database } from "@/lib/db";
import { cookies } from "next/headers";
import { principalHash, readCookie } from "./security";
import { UploadError } from "./validation";
export async function uploadIdentity() {
  const db=database(); const clinic=await db.clinic.findUnique({where:{slug:process.env.CLINIC_SLUG??"dr-sands"}});
  if(!clinic) throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
  const session=await auth();
  if(isAllowedEmail(session?.user?.email,process.env.ALLOWED_EMAILS)) return {clinic,principalHash:principalHash(`google:${session!.user!.email!.toLowerCase()}`)};
  const cookie=readCookie((await cookies()).get("posting-center-upload")?.value);
  if(cookie && cookie.clinicId===clinic.id && cookie.passcodeVersion===principalHash(clinic.uploadPasscodeHash)) return {clinic,principalHash:principalHash(`cookie:${cookie.id}`)};
  throw new UploadError("SIGN_IN_REQUIRED",401);
}
export async function jsonBody(request:Request) {
  if(request.headers.get("origin")!==process.env.APP_URL || !request.headers.get("content-type")?.startsWith("application/json")) throw new UploadError("REQUEST_REJECTED",403);
  if(Number(request.headers.get("content-length")??0)>262144) throw new UploadError("REQUEST_TOO_LARGE",413);
  const reader=request.body?.getReader(); if(!reader) throw new UploadError("INVALID_REQUEST");
  const parts:Uint8Array[]=[]; let length=0;
  while(true) {const {value,done}=await reader.read(); if(done)break; length+=value.length; if(length>262144){await reader.cancel();throw new UploadError("REQUEST_TOO_LARGE",413);} parts.push(value);}
  try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw new UploadError("INVALID_REQUEST");}
}
export function uploadResponse(value:unknown,status=200) {return Response.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}
export function uploadFailure(error:unknown) {
  // Never emit error objects: upstream errors can contain names, credentials,
  // SQL parameters, upload session URLs, or patient request bodies.
  return uploadResponse({error:error instanceof UploadError?error.code:"UPLOAD_UNAVAILABLE"},error instanceof UploadError?error.status:503);
}
