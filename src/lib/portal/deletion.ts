import { randomInt } from "node:crypto";
import { database } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { drive, getDriveFile } from "@/lib/upload/drive";
import { UploadError, type FilePlan } from "@/lib/upload/validation";
import type { portalIdentity } from "./access";

type Identity = Awaited<ReturnType<typeof portalIdentity>>;
type Tx = Prisma.TransactionClient;
const transactionOptions = { maxWait: 10000, timeout: 20000 };
const lock = async (tx: Tx, key: string) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`; };
const escapeQ = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function storageScope(root: string) {
  if (!root || root !== process.env.DRIVE_ROOT_FOLDER_ID) throw new UploadError("UPLOAD_SETUP_REQUIRED", 503);
}

// Never follow arbitrary IDs into another clinic's Drive. Deleted records remain
// as authorization/audit anchors; Drive trash is a separately retryable step.
async function insideRoot(id: string, root: string) {
  const visited = new Set<string>();
  let pending = [id];
  for (let depth = 0; depth < 12 && pending.length; depth++) {
    const parents: string[] = [];
    for (const current of pending) {
      if (current === root) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const item = await getDriveFile(current);
      if (item) parents.push(...(item.parents ?? []));
    }
    pending = parents;
  }
  return false;
}

async function trashFile(id: string, root: string, expectedKey: string) {
  const item = await getDriveFile(id);
  // A file already removed from Drive needs no further destructive operation.
  if (!item) return;
  if (item.appProperties?.postingCenterKey !== expectedKey || !await insideRoot(id, root)) {
    throw new UploadError("DELETION_PENDING", 503);
  }
  if (!item.trashed) await drive().files.update({
    fileId: id, supportsAllDrives: true, requestBody: { trashed: true }, fields: "id,trashed",
  });
  const verified = await getDriveFile(id);
  if (verified && !verified.trashed) throw new UploadError("DELETION_PENDING", 503);
}

async function patientFolder(id: string, knownId: string | null, root: string) {
  if (knownId) return knownId;
  // Recover a folder created by an interrupted provisioning transaction. Do not
  // create folders during deletion, and do not guess identity from names.
  const result = await drive().files.list({
    q: `mimeType='application/vnd.google-apps.folder' and appProperties has { key='postingCenterKey' and value='${escapeQ(`patient:${id}`)}' }`,
    supportsAllDrives: true, includeItemsFromAllDrives: true, pageSize: 100,
    fields: "files(id),nextPageToken",
  });
  if (result.data.nextPageToken || (result.data.files?.length ?? 0) > 1) throw new UploadError("DELETION_PENDING", 503);
  const found = result.data.files?.[0]?.id;
  if (found && !await insideRoot(found, root)) throw new UploadError("DELETION_PENDING", 503);
  return found ?? null;
}

async function trashReservedUpload(id: string, root: string, expectedKey: string) {
  if (!await getDriveFile(id)) {
    // A resumable POST can still finish after its parent is trashed. Consume
    // the reserved ID so every old session (including a URL lost on renewal)
    // must conflict instead of creating a new file after cleanup completes.
    // Use the clinic root because a previous cleanup may have trashed parents.
    // This marker contains no patient information or media bytes.
    try {
      await drive().files.create({
        supportsAllDrives: true,
        requestBody: { id, name: "Deleted upload", mimeType: "application/octet-stream", parents: [root], appProperties: { postingCenterKey: expectedKey } },
        fields: "id",
      });
    } catch (error) {
      // A concurrent completion or deletion may have consumed the same ID.
      // Only a verified, correctly owned file can satisfy this cleanup.
      if ((error as { code?: number }).code !== 409) throw error;
    }
  }
  await trashFile(id, root, expectedKey);
  const verified = await getDriveFile(id);
  if (!verified?.trashed || verified.appProperties?.postingCenterKey !== expectedKey) throw new UploadError("DELETION_PENDING", 503);
}

async function finishPatientDeletion(id: string, clinicId: string, root: string) {
  try {
    const patient = await database().patient.findFirst({ where: { id, clinicId, deletedAt: { not: null } } });
    if (!patient) throw new UploadError("PATIENT_NOT_FOUND", 404);
    if (patient.driveTrashedAt) return;
    const folder = await patientFolder(id, patient.driveFolderId, root);
    // Include reserved uploads as well as confirmed media. A completed file may
    // not have reached confirmation before deletion, and staff may have moved it.
    const batches = await database().uploadBatch.findMany({ where: { session: { patientId: id } }, select: { id: true, manifest: true } });
    const targets = new Map<string, string>();
    for (const batch of batches) for (const plan of batch.manifest as unknown as FilePlan[]) {
      if (plan.driveId) targets.set(plan.driveId, `file:${batch.id}:${plan.key}`);
    }
    const records = await database().media.findMany({ where: { session: { patientId: id } }, select: { driveFileId: true } });
    const ids = [...new Set([...targets.keys(), ...records.map(record => record.driveFileId)])];
    for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async fileId => {
        const key = targets.get(fileId);
        if (key) await trashReservedUpload(fileId, root, key);
        else {
          const item = await getDriveFile(fileId);
          if (item && !item.trashed) throw new UploadError("DELETION_PENDING", 503);
        }
      }));
    }
    if (folder) await trashFile(folder, root, `patient:${id}`);
    const now = new Date();
    await database().$transaction(async tx => {
      await lock(tx, `patient:${id}`);
      await tx.patient.update({ where: { id }, data: { driveTrashedAt: now } });
      await tx.media.updateMany({ where: { session: { patientId: id }, deletedAt: { not: null }, driveTrashedAt: null }, data: { driveTrashedAt: now } });
    }, transactionOptions);
  } catch { throw new UploadError("DELETION_PENDING", 503); }
}

async function finishMediaDeletion(id: string, clinicId: string, root: string, general: boolean) {
  try {
    const record = general
      ? await database().generalMedia.findFirst({ where: { id, deletedAt: { not: null }, generalUpload: { clinicId } }, include: { generalUpload: { include: { uploadBatch: true } } } })
      : await database().media.findFirst({ where: { id, deletedAt: { not: null }, session: { patient: { clinicId } } }, include: { session: { include: { uploadBatch: true } } } });
    if (!record) throw new UploadError("MEDIA_NOT_FOUND", 404);
    if (record.driveTrashedAt) return;
    const batch = "session" in record ? record.session.uploadBatch : record.generalUpload.uploadBatch;
    const plan = (batch?.manifest as unknown as FilePlan[] | undefined)?.find(file => file.driveId === record.driveFileId);
    if (!batch || !plan?.deletedAt) throw new UploadError("DELETION_PENDING", 503);
    await trashFile(record.driveFileId, root, `file:${batch.id}:${plan.key}`);
    if (general) await database().generalMedia.update({ where: { id }, data: { driveTrashedAt: new Date() } });
    else await database().media.update({ where: { id }, data: { driveTrashedAt: new Date() } });
  } catch { throw new UploadError("DELETION_PENDING", 503); }
}

export async function deletePatient(id: string, identity: Identity) {
  storageScope(identity.clinic.driveRootFolderId);
  await database().$transaction(async tx => {
    // Uploads hold batch then patient. Patient deletion needs only the patient
    // lock, so it cannot deadlock with a batch already waiting for this lock.
    await lock(tx, `patient:${id}`);
    const patient = await tx.patient.findFirst({ where: { id, clinicId: identity.clinic.id } });
    if (!patient) throw new UploadError("PATIENT_NOT_FOUND", 404);
    if (!patient.deletedAt) {
      const now = new Date();
      await tx.patient.update({ where: { id }, data: { deletedAt: now, lifecycleVersion: { increment: 1 } } });
      await tx.media.updateMany({ where: { session: { patientId: id }, deletedAt: null }, data: { deletedAt: now } });
      await tx.shareLink.updateMany({ where: { patientId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.patientActivity.create({ data: { patientId: id, action: "deleted", actor: identity.email, patientVersion: patient.lifecycleVersion + 1 } });
    }
  }, transactionOptions);
  await finishPatientDeletion(id, identity.clinic.id, identity.clinic.driveRootFolderId);
  return { deleted: true };
}

export async function deleteMedia(id: string, identity: Identity, general: boolean) {
  storageScope(identity.clinic.driveRootFolderId);
  await database().$transaction(async tx => {
    const initial = general
      ? await tx.generalMedia.findFirst({ where: { id, generalUpload: { clinicId: identity.clinic.id } }, include: { generalUpload: true } })
      : await tx.media.findFirst({ where: { id, session: { patient: { clinicId: identity.clinic.id } } }, include: { session: true } });
    if (!initial) throw new UploadError("MEDIA_NOT_FOUND", 404);
    const uploadId = "session" in initial ? initial.session.uploadId : initial.generalUpload.uploadId;
    await lock(tx, `batch:${uploadId}`);
    if ("session" in initial) await lock(tx, `patient:${initial.session.patientId}`);
    const batch = await tx.uploadBatch.findUnique({ where: { id: uploadId } });
    const files = batch?.manifest as unknown as FilePlan[] | undefined;
    const plan = files?.find(file => file.driveId === initial.driveFileId);
    if (!batch || !plan?.confirmed) throw new UploadError("UPLOAD_INCOMPLETE", 409);
    const record = general ? await tx.generalMedia.findUniqueOrThrow({ where: { id } }) : await tx.media.findUniqueOrThrow({ where: { id } });
    const deletedAt = record.deletedAt ?? new Date();
    if (!record.deletedAt) {
      if (general) await tx.generalMedia.update({ where: { id }, data: { deletedAt } });
      else await tx.media.update({ where: { id }, data: { deletedAt } });
    }
    if (!plan.deletedAt) {
      plan.deletedAt = deletedAt.toISOString();
      delete plan.encryptedUrl;
      await tx.uploadBatch.update({ where: { id: uploadId }, data: { manifest: files as unknown as Prisma.InputJsonValue } });
    }
  }, transactionOptions);
  await finishMediaDeletion(id, identity.clinic.id, identity.clinic.driveRootFolderId, general);
  return { deleted: true };
}

// The authenticated storage check can complete cleanup after a dropped request.
// Bound work per run; never reopen access or discard an unfinished tombstone.
export async function retryPendingDeletions(clinicId: string) {
  const clinic = await database().clinic.findUniqueOrThrow({ where: { id: clinicId } });
  storageScope(clinic.driveRootFolderId);
  const patients = await database().patient.findMany({ where: { clinicId, deletedAt: { not: null }, driveTrashedAt: null }, select: { id: true } });
  const media = await database().media.findMany({ where: { deletedAt: { not: null }, driveTrashedAt: null, session: { patient: { clinicId, deletedAt: null } } }, select: { id: true } });
  const general = await database().generalMedia.findMany({ where: { deletedAt: { not: null }, driveTrashedAt: null, generalUpload: { clinicId } }, select: { id: true } });
  const groups = [
    patients.map(p => () => finishPatientDeletion(p.id, clinicId, clinic.driveRootFolderId)),
    media.map(m => () => finishMediaDeletion(m.id, clinicId, clinic.driveRootFolderId, false)),
    general.map(m => () => finishMediaDeletion(m.id, clinicId, clinic.driveRootFolderId, true)),
  ];
  // Mix each queue and alternate categories so a permanently blocked folder
  // cannot monopolize every retry or prevent independent files from finishing.
  for (const group of groups) for (let i = group.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [group[i], group[j]] = [group[j], group[i]];
  }
  const jobs: (() => Promise<void>)[] = [];
  for (let i = 0; jobs.length < 10 && groups.some(group => i < group.length); i++) {
    for (const group of groups) if (group[i] && jobs.length < 10) jobs.push(group[i]);
  }
  let completed = 0;
  for (const job of jobs) { try { await job(); completed++; } catch { /* Durable tombstone remains pending. */ } }
  const remaining = await Promise.all([
    database().patient.count({ where: { clinicId, deletedAt: { not: null }, driveTrashedAt: null } }),
    database().media.count({ where: { deletedAt: { not: null }, driveTrashedAt: null, session: { patient: { clinicId, deletedAt: null } } } }),
    database().generalMedia.count({ where: { deletedAt: { not: null }, driveTrashedAt: null, generalUpload: { clinicId } } }),
  ]);
  return { completed, pending: remaining.reduce((sum, count) => sum + count, 0) };
}
