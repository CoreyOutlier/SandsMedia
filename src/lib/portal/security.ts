import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function validToken(token: unknown): token is string { return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token); }
export function activeLink(link: { expiresAt: Date | string; revokedAt: unknown; patient: { consentWithdrawnAt: unknown } }, now = Date.now()) {
  return !link.revokedAt && !link.patient.consentWithdrawnAt && new Date(link.expiresAt).getTime() > now;
}
function secret() { const value = process.env.SHARE_SECRET; if (!value || value.length < 32) throw new Error("SHARE_SETUP_REQUIRED"); return value; }
export function signTicket(value: Record<string, unknown>, purpose: string) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(`${purpose}:${body}`).digest("base64url")}`;
}
export function readTicket(value: string | undefined | null, purpose: string, now = Date.now()): Record<string, unknown> | null {
  try {
    if (!value || value.length > 2048) return null;
    const [body, signature, extra] = value.split("."); if (extra !== undefined || !signature) return null;
    const expected = createHmac("sha256", secret()).update(`${purpose}:${body}`).digest(); const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    return typeof data.expires === "number" && data.expires > now ? data : null;
  } catch { return null; }
}
export function byteRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("INVALID_RANGE");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error("INVALID_RANGE");
  return { start, end };
}
