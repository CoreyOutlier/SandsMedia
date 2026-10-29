import { portalIdentity } from "@/lib/portal/access";
import { listLibrary } from "@/lib/portal/library";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
export async function POST(request:Request){try{const {clinic}=await portalIdentity();return uploadResponse(await listLibrary(await jsonBody(request),clinic.id));}catch(e){return uploadFailure(e);}}
