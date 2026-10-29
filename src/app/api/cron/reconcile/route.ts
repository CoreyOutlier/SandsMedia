import { timingSafeEqual } from "node:crypto";
import { database } from "@/lib/db";
import { reconcile } from "@/lib/portal/reconcile";
import { uploadResponse } from "@/lib/upload/http";
export const maxDuration=300;
export async function GET(request:Request){const expected=process.env.CRON_SECRET;const supplied=request.headers.get("authorization")??"";const a=Buffer.from(`Bearer ${expected??""}`),b=Buffer.from(supplied);if(!expected||a.length!==b.length||!timingSafeEqual(a,b))return uploadResponse({error:"SIGN_IN_REQUIRED"},401);try{const clinic=await database().clinic.findUnique({where:{slug:process.env.CLINIC_SLUG??"dr-sands"}});if(!clinic)return uploadResponse({error:"CLINIC_UNAVAILABLE"},503);const result=await reconcile(clinic.id);if(result.missing||result.mismatched)console.warn("STORAGE_RECONCILIATION_REVIEW_REQUIRED");return uploadResponse(result);}catch{return uploadResponse({error:"RECONCILIATION_FAILED"},503);}}
