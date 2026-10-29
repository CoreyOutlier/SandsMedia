export class UploadError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code=code; this.status=status; }
}
export const labels = ["before", "after", "testimonial", "other"] as const;
export type Label = typeof labels[number];
export type FilePlan = { key: string; fingerprint: string; kind: "photo" | "video"; label: Label; mimeType: string; bytes: number; width: number; height: number; durationS: number | null; name: string; driveId?: string; encryptedUrl?: string; confirmed?: boolean };
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function textField(v: unknown, max: number, required = true, multiline = false): string {
  if (typeof v !== "string" || v.length > max || /[\u0000-\u001f\u007f]/.test(multiline?v.replace(/\n/g, ""):v)) throw new UploadError("INVALID_FIELDS");
  const s = v.trim(); if (required && !s) throw new UploadError("REQUIRED_FIELDS"); return s;
}
export function validateStart(value: unknown, maxVideoMB: number) {
  if(!Number.isFinite(maxVideoMB)||maxVideoMB<=0||maxVideoMB>500) throw new UploadError("UPLOAD_SETUP_REQUIRED",503);
  const x = value as Record<string, unknown>;
  if (!x || !uuid(x.uploadId) || !["patient", "general"].includes(String(x.kind))) throw new UploadError("INVALID_UPLOAD");
  const date = textField(x.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new UploadError("INVALID_DATE");
  const general = x.kind === "general";
  const patientId = x.patientId == null ? null : x.patientId;
  if (patientId !== null && !uuid(patientId)) throw new UploadError("INVALID_PATIENT");
  const firstName = !general && !patientId ? textField(x.firstName, 80) : "";
  const lastName = !general && !patientId ? textField(x.lastName, 80) : "";
  const title = general ? textField(x.title, 120) : textField(x.treatment, 120);
  const description = textField(x.description, 2000, false, true);
  const uploadedBy = textField(x.uploadedBy, 100);
  if (typeof x.consented !== "boolean" || typeof x.formOnFile !== "boolean" || (x.formOnFile && !x.consented)) throw new UploadError("INVALID_CONSENT");
  if (!Array.isArray(x.files) || x.files.length < 1 || x.files.length > 100) throw new UploadError("FILE_COUNT");
  const seen = new Set<string>(); const counters: Record<string, number> = {};
  const files: FilePlan[] = x.files.map((f: Record<string, unknown>) => {
    if (!f || !uuid(f.key) || seen.has(f.key) || typeof f.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(f.fingerprint)) throw new UploadError("INVALID_FILE");
    seen.add(f.key);
    const kind = f.kind; const mime = f.mimeType;
    if (kind !== "photo" && kind !== "video") throw new UploadError("INVALID_FILE");
    const ext = kind === "photo" && mime === "image/jpeg" ? "jpg" : kind === "video" ? ({ "video/mp4":"mp4", "video/quicktime":"mov", "video/webm":"webm", "video/x-m4v":"m4v" } as Record<string,string>)[String(mime)] : undefined;
    if (!ext) throw new UploadError("UNSUPPORTED_FILE");
    if (!Number.isSafeInteger(f.bytes) || Number(f.bytes) < 1 || Number(f.bytes) > (kind === "photo" ? 20 : maxVideoMB) * 1024 * 1024) throw new UploadError("FILE_TOO_LARGE");
    if (![f.width,f.height].every(n => Number.isSafeInteger(n) && Number(n)>0 && Number(n)<=32768) || (kind === "photo" && Math.max(Number(f.width),Number(f.height))>2048)) throw new UploadError("INVALID_DIMENSIONS");
    if (kind === "video" && (typeof f.durationS !== "number" || !Number.isFinite(f.durationS) || f.durationS <= 0 || f.durationS>180)) throw new UploadError("VIDEO_TOO_LONG");
    const label = general ? "other" : f.label;
    if (!labels.includes(label as Label)) throw new UploadError("INVALID_LABEL");
    const counterKey = `${kind}:${label}`; counters[counterKey]=(counters[counterKey]??0)+1;
    return { key:f.key, fingerprint:f.fingerprint, kind, label:label as Label, mimeType:String(mime), bytes:Number(f.bytes), width:Number(f.width), height:Number(f.height), durationS:kind === "video" ? Number(f.durationS) : null, name:`${label}-${String(counters[counterKey]).padStart(2,"0")}.${ext}` };
  });
  return { uploadId:x.uploadId, general, patientId:patientId as string|null, firstName,lastName,title,description,uploadedBy,date,consented:!general && x.consented,formOnFile:!general && x.formOnFile,files };
}
export function folderName(s: string) { return s.replace(/[\/\\\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,160); }
export function patientFolderName(firstName:string,lastName:string,displayId:string) {
  const suffix=` – ${displayId}`;
  return folderName(`${lastName}, ${firstName}`).slice(0,160-suffix.length).trimEnd()+suffix;
}
