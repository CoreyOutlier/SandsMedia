import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { UploadError } from "./validation.ts";
export function secret() { const s=process.env.COOKIE_SECRET ?? process.env.AUTH_SECRET; if(!s) throw new UploadError("UPLOAD_SETUP_REQUIRED",503); return s; }
export function principalHash(value:string) { return createHmac("sha256",secret()).update(value).digest("hex"); }
export function seal(value:string) {
  const iv=randomBytes(12); const cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(secret()).digest(),iv);
  return Buffer.concat([iv,cipher.update(value,"utf8"),cipher.final(),cipher.getAuthTag()]).toString("base64url");
}
export function unseal(value:string) {
  try { const raw=Buffer.from(value,"base64url"); const decipher=createDecipheriv("aes-256-gcm",createHash("sha256").update(secret()).digest(),raw.subarray(0,12)); decipher.setAuthTag(raw.subarray(-16)); return Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString("utf8"); }
  catch { throw new UploadError("UPLOAD_SESSION_EXPIRED",409); }
}
export function signCookie(value:object) { const payload=Buffer.from(JSON.stringify(value)).toString("base64url"); return `${payload}.${principalHash(payload)}`; }
export function readCookie(value:string|undefined): {clinicId:string; passcodeVersion:string; expires:number; id:string}|null {
  try { const pieces=value!.split("."); if(pieces.length!==2)return null; const [p,s]=pieces; const expected=principalHash(p); if(!s || s.length!==expected.length || !timingSafeEqual(Buffer.from(s),Buffer.from(expected))) return null; const decoded=JSON.parse(Buffer.from(p,"base64url").toString()); return typeof decoded.clinicId==="string"&&typeof decoded.id==="string"&&typeof decoded.passcodeVersion==="string"&&Number.isFinite(decoded.expires)&&decoded.expires>Date.now()?decoded:null; } catch { return null; }
}
