import { database } from "@/lib/db";
import { requireShare,shareData } from "@/lib/portal/shares";
import { rateLimit,requestIdentity } from "@/lib/portal/access";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { validToken } from "@/lib/portal/security";
import { UploadError } from "@/lib/upload/validation";
export async function POST(request:Request){try{const b=await jsonBody(request);if(!validToken(b.token))throw new UploadError("LINK_EXPIRED",404);const link=await requireShare(b.token);if(b.refresh!==true){await rateLimit(`view:${link.id}`,request,60,1);await database().$transaction([database().shareView.create({data:{shareLinkId:link.id,...requestIdentity(request)}}),database().shareLink.update({where:{id:link.id},data:{viewCount:{increment:1},lastViewedAt:new Date()}})]);}return uploadResponse(await shareData(b.token));}catch(e){return uploadFailure(e);}}
