import { uploadIdentity, jsonBody, uploadResponse, uploadFailure } from "@/lib/upload/http";
import { startBatch } from "@/lib/upload/service";
import { storageConfigured } from "@/lib/upload/drive";
import { UploadError } from "@/lib/upload/validation";
export const maxDuration=60;
export async function POST(request:Request) {try { const body=await jsonBody(request); const identity=await uploadIdentity(); if(!storageConfigured())throw new UploadError("UPLOAD_SETUP_REQUIRED",503); return uploadResponse(await startBatch(body,identity)); }catch(e){return uploadFailure(e);} }
