import { allowedMedia,mediaResponse } from "@/lib/portal/media";
import { uploadFailure } from "@/lib/upload/http";
export const maxDuration=300;
export async function GET(request:Request,{params}:{params:Promise<{id:string;action:string}>}){try{const {id,action}=await params;return await mediaResponse(await allowedMedia(id,request),action,request);}catch(e){return uploadFailure(e);}}
