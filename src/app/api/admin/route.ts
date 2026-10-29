import { reconcile } from "@/lib/portal/reconcile";
import { hash } from "bcryptjs";
import { database } from "@/lib/db";
import { portalIdentity } from "@/lib/portal/access";
import { parseAllowlist } from "@/lib/access";
import { textField,UploadError } from "@/lib/upload/validation";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
export const maxDuration=300;
export async function GET(){try{const {clinic}=await portalIdentity();return uploadResponse({name:clinic.name,slug:clinic.slug,emails:[...parseAllowlist(process.env.ALLOWED_EMAILS)],storageReady:!!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,sharingReady:!!process.env.SHARE_SECRET});}catch(e){return uploadFailure(e);}}
export async function POST(request:Request){try{const {clinic}=await portalIdentity();const b=await jsonBody(request);if(b.action==="reconcile")return uploadResponse(await reconcile(clinic.id));if(b.action==="name")await database().clinic.update({where:{id:clinic.id},data:{name:textField(b.name,120)}});else if(b.action==="passcode"){const code=textField(b.passcode,100);if(code.length<12)throw new UploadError("PASSCODE_TOO_SHORT");await database().clinic.update({where:{id:clinic.id},data:{uploadPasscodeHash:await hash(code,12)}});}else throw new UploadError("INVALID_FIELDS");return uploadResponse({ok:true});}catch(e){return uploadFailure(e);}}
