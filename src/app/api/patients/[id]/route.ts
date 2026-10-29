import { portalIdentity } from "@/lib/portal/access";
import { patientDetail } from "@/lib/portal/library";
import { patientAction } from "@/lib/portal/lifecycle";
import { jsonBody,uploadResponse,uploadFailure } from "@/lib/upload/http";
import { UploadError,uuid } from "@/lib/upload/validation";
export const maxDuration=300;
type Context={params:Promise<{id:string}>};
export async function GET(_:Request,{params}:Context){try{const {clinic}=await portalIdentity();return uploadResponse(await patientDetail((await params).id,clinic.id));}catch(e){return uploadFailure(e);}}
export async function POST(request:Request,{params}:Context){try{
 const identity=await portalIdentity();const {id}=await params;if(!uuid(id))throw new UploadError("PATIENT_NOT_FOUND",404);
 const body=await jsonBody(request);if(!body||typeof body!=="object"||Array.isArray(body))throw new UploadError("INVALID_FIELDS");
 await patientAction(id,identity,body,request);
 return uploadResponse(await patientDetail(id,identity.clinic.id));
}catch(e){return uploadFailure(e);}}
