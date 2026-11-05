import { ANONYMOUS_USE_TEXT_VERSION } from "@/lib/anonymous-use";
import { portalIdentity } from "@/lib/portal/access";
import { createAnonymousReview, setAnonymousUse } from "@/lib/portal/anonymous-use";
import { jsonBody, uploadFailure, uploadResponse } from "@/lib/upload/http";
import { UploadError, uuid } from "@/lib/upload/validation";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await portalIdentity();
    const { id } = await params;
    return uploadResponse(await createAnonymousReview(id, identity, request.signal));
  } catch (error) { return uploadFailure(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await portalIdentity();
    const { id } = await params;
    if (!uuid(id)) throw new UploadError("MEDIA_NOT_FOUND", 404);
    const body = await jsonBody(request);
    if (!body || Array.isArray(body) || typeof body.approved !== "boolean" || body.confirmed !== true ||
        body.policyVersion !== ANONYMOUS_USE_TEXT_VERSION || !uuid(body.requestId)) throw new UploadError("INVALID_ANONYMOUS_APPROVAL");
    if (body.reviewToken !== undefined && (typeof body.reviewToken !== "string" || body.reviewToken.length > 2048)) throw new UploadError("ANONYMOUS_REVIEW_REQUIRED", 409);
    return uploadResponse(await setAnonymousUse(id, identity, { approved: body.approved, requestId: body.requestId, reviewToken: body.reviewToken }));
  } catch (error) { return uploadFailure(error); }
}
