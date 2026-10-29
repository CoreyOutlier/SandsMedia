import { portalIdentity } from "@/lib/portal/access";
import { generalDetail } from "@/lib/portal/library";
import { uploadResponse,uploadFailure } from "@/lib/upload/http";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const {clinic}=await portalIdentity();return uploadResponse(await generalDetail((await params).id,clinic.id));}catch(e){return uploadFailure(e);}}
