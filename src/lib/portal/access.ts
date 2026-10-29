import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/access";
import { database } from "@/lib/db";
import { UploadError } from "@/lib/upload/validation";
import { principalHash } from "@/lib/upload/security";
import { isIP } from "node:net";
export async function portalIdentity() {
  const session = await auth();
  if (!isAllowedEmail(session?.user?.email, process.env.ALLOWED_EMAILS)) throw new UploadError("SIGN_IN_REQUIRED", 401);
  const clinic = await database().clinic.findUnique({ where: { slug: process.env.CLINIC_SLUG ?? "dr-sands" } });
  if (!clinic) throw new UploadError("UPLOAD_SETUP_REQUIRED", 503);
  return { clinic, email: session!.user!.email! };
}
export function requestIdentity(request: Request) {
  const raw = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return { ip: isIP(raw) ? raw : "0.0.0.0", userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 500) };
}
export async function rateLimit(scope: string, request: Request, limit = 5, minutes = 15) {
  const key = principalHash(`${scope}:${requestIdentity(request).ip}`);
  await database().$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const old = await tx.uploadAttempt.findUnique({ where: { key } }); const now = new Date();
    if (old && now.getTime() - old.startedAt.getTime() < minutes * 60000) {
      if (old.attempts >= limit) throw new UploadError("TOO_MANY_ATTEMPTS", 429);
      await tx.uploadAttempt.update({ where: { key }, data: { attempts: { increment: 1 } } });
    } else await tx.uploadAttempt.upsert({ where: { key }, create: { key, startedAt: now, attempts: 1 }, update: { startedAt: now, attempts: 1 } });
  });
}
