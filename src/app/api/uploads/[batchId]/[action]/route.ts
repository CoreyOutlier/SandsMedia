import { uploadIdentity, jsonBody, uploadResponse, uploadFailure } from "@/lib/upload/http";
import { getBatch,signFile,confirmFile,finishBatch,renewFile } from "@/lib/upload/service";
import { UploadError,uuid } from "@/lib/upload/validation";
export const maxDuration=60;
type Context={params:Promise<{batchId:string;action:string}>};
export async function GET(_request:Request,context:Context) {try {const {batchId,action}=await context.params;if(!uuid(batchId)||action!=="status")throw new UploadError("NOT_FOUND",404);return uploadResponse(await getBatch(batchId,await uploadIdentity()));}catch(e){return uploadFailure(e);}}
export async function POST(request:Request,context:Context) {try {const body=await jsonBody(request);const {batchId,action}=await context.params;if(!uuid(batchId))throw new UploadError("NOT_FOUND",404);const identity=await uploadIdentity();if(action==="finish")return uploadResponse(await finishBatch(batchId,identity,request));if(!uuid(body.key))throw new UploadError("INVALID_FILE");if(action==="sign")return uploadResponse(await signFile(batchId,body.key,identity));if(action==="media")return uploadResponse(await confirmFile(batchId,body.key,identity));if(action==="renew"){await renewFile(batchId,body.key,identity);return uploadResponse({renewed:true});}throw new UploadError("NOT_FOUND",404);}catch(e){return uploadFailure(e);}}
