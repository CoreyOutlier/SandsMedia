import { compare } from "bcryptjs";
import { cookies } from "next/headers";
import { findShare } from "@/lib/portal/shares";
import { signTicket,hashToken } from "@/lib/portal/security";
import { rateLimit } from "@/lib/portal/access";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { UploadError } from "@/lib/upload/validation";
export async function POST(request:Request){try{const b=await jsonBody(request);await rateLimit("share-pin",request);const link=typeof b.token==="string"?await findShare(b.token):null;if(!link)throw new UploadError("LINK_EXPIRED",404);if(typeof b.pin!=="string"||!/^\d{4}$/.test(b.pin)||!link.pinHash||!await compare(b.pin,link.pinHash))throw new UploadError("PIN_INCORRECT",401);const maxAge=Math.min(30*86400,Math.floor((link.expiresAt.getTime()-Date.now())/1000));(await cookies()).set(`pc-pin-${link.id}`,signTicket({shareId:link.id,version:hashToken(link.pinHash),expires:Date.now()+maxAge*1000},"pin"),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge});return uploadResponse({ok:true});}catch(e){return uploadFailure(e);}}
