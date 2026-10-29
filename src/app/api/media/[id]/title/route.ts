import { database } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { portalIdentity } from "@/lib/portal/access";
import { drive, getDriveFile } from "@/lib/upload/drive";
import { jsonBody, uploadFailure, uploadResponse } from "@/lib/upload/http";
import { mediaTitle, namedVideoFile, UploadError, uuid, type FilePlan } from "@/lib/upload/validation";

export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
type MediaRecord = { id: string; kind: string; driveFileId: string; fileName: string };

async function renameVideo(tx: Prisma.TransactionClient, record: MediaRecord, uploadId: string, title: string | null, general: boolean) {
  if (record.kind !== "video") throw new UploadError("VIDEO_REQUIRED", 400);
  const batch = await tx.uploadBatch.findUnique({ where: { id: uploadId } });
  const files = batch?.manifest as unknown as FilePlan[] | undefined;
  const plan = files?.find(file => file.driveId === record.driveFileId && file.confirmed);
  if (!batch?.videosFolderId || !plan) throw new UploadError("UPLOAD_INCOMPLETE", 409);
  const actual = await getDriveFile(record.driveFileId);
  if (!actual || actual.trashed || !actual.parents?.includes(batch.videosFolderId)
    || actual.appProperties?.postingCenterKey !== `file:${uploadId}:${plan.key}`) {
    throw new UploadError("FILE_NOT_CONFIRMED", 409);
  }
  const fileName = namedVideoFile(record.fileName, title);
  // Update the private Drive object first. The ID and label-counter remain fixed,
  // so retrying after a response/commit failure converges on this same name.
  try {
    await drive().files.update({ fileId: record.driveFileId, supportsAllDrives: true, requestBody: { name: fileName }, fields: "id" });
  } catch { throw new UploadError("DRIVE_UNAVAILABLE", 503); }
  if (general) await tx.generalMedia.update({ where: { id: record.id }, data: { title, fileName } });
  else await tx.media.update({ where: { id: record.id }, data: { title, fileName } });
  plan.title = title;
  plan.name = fileName;
  await tx.uploadBatch.update({ where: { id: uploadId }, data: { manifest: files as unknown as Prisma.InputJsonValue } });
  return { id: record.id, title, fileName };
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { clinic } = await portalIdentity();
    const { id } = await params;
    if (!uuid(id)) throw new UploadError("MEDIA_NOT_FOUND", 404);
    const body = await jsonBody(request);
    if (!body || typeof body.general !== "boolean" || !Object.hasOwn(body, "title")) throw new UploadError("INVALID_FIELDS");
    const title = mediaTitle(body.title);
    const result = await database().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`media-title:${body.general}:${id}`}))`;
      if (body.general) {
        const record = await tx.generalMedia.findFirst({ where: { id, generalUpload: { clinicId: clinic.id } }, include: { generalUpload: true } });
        if (!record) throw new UploadError("MEDIA_NOT_FOUND", 404);
        if (!record.generalUpload.finishedAt) throw new UploadError("UPLOAD_INCOMPLETE", 409);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`batch:${record.generalUpload.uploadId}`}))`;
        return renameVideo(tx, record, record.generalUpload.uploadId, title, true);
      }
      const record = await tx.media.findFirst({ where: { id, session: { patient: { clinicId: clinic.id } } }, include: { session: true } });
      if (!record) throw new UploadError("MEDIA_NOT_FOUND", 404);
      if (!record.session.finishedAt) throw new UploadError("UPLOAD_INCOMPLETE", 409);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`batch:${record.session.uploadId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${record.session.patientId}`}))`;
      const patient = await tx.patient.findUniqueOrThrow({ where: { id: record.session.patientId }, select: { archivedAt: true } });
      if (patient.archivedAt) throw new UploadError("PATIENT_ARCHIVED", 409);
      return renameVideo(tx, record, record.session.uploadId, title, false);
    }, { maxWait: 10000, timeout: 45000 });
    return uploadResponse(result);
  } catch (error) { return uploadFailure(error); }
}
