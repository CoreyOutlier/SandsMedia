import { portalIdentity } from "@/lib/portal/access";
import { anonymousReviewBytes } from "@/lib/portal/anonymous-use";
import { uploadFailure } from "@/lib/upload/http";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const identity = await portalIdentity();
    const { id } = await params;
    const bytes = await anonymousReviewBytes(id, new URL(request.url).searchParams.get("review"), identity, request.signal);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    } });
  } catch (error) { return uploadFailure(error); }
}
