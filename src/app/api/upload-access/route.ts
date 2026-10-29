import { compare } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { database } from "@/lib/db";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { principalHash,signCookie } from "@/lib/upload/security";
import { UploadError } from "@/lib/upload/validation";
export async function POST(request:Request) {
  try {
    const body=await jsonBody(request);if(typeof body.passcode!=="string"||body.passcode.length>100)throw new UploadError("PASSCODE_INCORRECT",401);
    const db=database();const clinic=await db.clinic.findUnique({where:{slug:process.env.CLINIC_SLUG??"dr-sands"}});if(!clinic)throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
    const ip=request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()??"local";
    const key=principalHash(`attempt:${clinic.id}:${ip}`);
    await db.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const prior=await tx.uploadAttempt.findUnique({where:{key}});const now=new Date();
      if(prior && now.getTime()-prior.startedAt.getTime()<15*60*1000){if(prior.attempts>=5)throw new UploadError("TOO_MANY_ATTEMPTS",429);await tx.uploadAttempt.update({where:{key},data:{attempts:{increment:1}}});}
      else await tx.uploadAttempt.upsert({where:{key},create:{key,startedAt:now,attempts:1},update:{startedAt:now,attempts:1}});
    });
    if(!await compare(body.passcode,clinic.uploadPasscodeHash))throw new UploadError("PASSCODE_INCORRECT",401);
    const maxAge=30*24*60*60;
    (await cookies()).set("posting-center-upload",signCookie({clinicId:clinic.id,passcodeVersion:principalHash(clinic.uploadPasscodeHash),expires:Date.now()+maxAge*1000,id:randomUUID()}),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge});
    return uploadResponse({ok:true});
  }catch(e){return uploadFailure(e);}
}
