import { portalIdentity } from "@/lib/portal/access";
import { deleteMedia } from "@/lib/portal/deletion";
import { jsonBody, uploadFailure, uploadResponse } from "@/lib/upload/http";
import { UploadError, uuid } from "@/lib/upload/validation";
export const maxDuration = 300;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await portalIdentity();
    const { id } = await params;
    if (!uuid(id)) throw new UploadError("MEDIA_NOT_FOUND", 404);
    const body = await jsonBody(request);
    if (!body || Array.isArray(body) || body.confirmed !== true || typeof body.general !== "boolean") throw new UploadError("INVALID_FIELDS");
    return uploadResponse(await deleteMedia(id, identity, body.general));
  } catch (error) { return uploadFailure(error); }
}
