import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Prisma } from "@/generated/prisma/client";
import { database } from "@/lib/db";
import { ANONYMOUS_USE_TEXT, ANONYMOUS_USE_TEXT_VERSION, eligibleAnonymousMedia, matchesAnonymousReview } from "@/lib/anonymous-use";
import { drive } from "@/lib/upload/drive";
import { principalHash } from "@/lib/upload/security";
import { FilePlan, UploadError, uuid } from "@/lib/upload/validation";
import { anonymousJpeg, MAX_ANONYMOUS_PHOTO_BYTES } from "./jpeg";
import type { portalIdentity } from "./access";
import { readTicket, signTicket } from "./security";

type Tx = Prisma.TransactionClient;
export const anonymousMediaInclude = {
  useEvents: { orderBy: { version: "desc" }, take: 1 },
  session: { include: { patient: { include: { clinic: true } }, uploadBatch: true } },
} as const;
type Photo = Prisma.MediaGetPayload<{ include: typeof anonymousMediaInclude }>;
type Options = { approvalId?: string; patientId?: string; signal?: AbortSignal };
type Snapshot = { fileChecksum: string; exportChecksum: string; driveVersion: string; md5Checksum: string; bytes: Buffer };
const unavailable = () => new UploadError("ANONYMOUS_PHOTO_UNAVAILABLE", 409);
const digest = (algorithm: string, value: Uint8Array) => createHash(algorithm).update(value).digest("hex");

function photoTarget(media: Photo) {
  const { patient, uploadBatch } = media.session;
  const root = patient.clinic.driveRootFolderId;
  if (root !== process.env.DRIVE_ROOT_FOLDER_ID || !uploadBatch?.photosFolderId || media.kind !== "photo" || media.deletedAt || patient.deletedAt) throw unavailable();
  const file = (uploadBatch.manifest as unknown as FilePlan[]).find(f => f.driveId === media.driveFileId && f.kind === "photo" && !f.deletedAt);
  if (!file) throw unavailable();
  return { id: media.driveFileId, root, parent: uploadBatch.photosFolderId, key: `file:${uploadBatch.id}:${file.key}`, size: Number(media.bytes) };
}
type Target = ReturnType<typeof photoTarget>;
const metadataFields = "id,mimeType,size,trashed,headRevisionId,md5Checksum,parents,appProperties";
async function metadata(id: string, signal: AbortSignal) {
  try { return (await drive().files.get({ fileId: id, supportsAllDrives: true, fields: metadataFields }, { signal })).data; }
  catch { throw unavailable(); }
}
async function insideRoot(id: string, root: string, signal: AbortSignal) {
  const seen = new Set<string>();
  for (let depth = 0; depth < 12; depth++) {
    if (id === root) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const folder = await metadata(id, signal);
    if (folder.trashed || folder.mimeType !== "application/vnd.google-apps.folder" || folder.parents?.length !== 1) return false;
    id = folder.parents[0];
  }
  return false;
}
async function checkedMetadata(target: Target, signal: AbortSignal) {
  const meta = await metadata(target.id, signal);
  if (meta.trashed || meta.mimeType !== "image/jpeg" || meta.parents?.length !== 1 || meta.parents[0] !== target.parent ||
      meta.appProperties?.postingCenterKey !== target.key || Number(meta.size) !== target.size || !Number.isSafeInteger(target.size) ||
      target.size < 1 || target.size > MAX_ANONYMOUS_PHOTO_BYTES || !/^[A-Za-z0-9_-]{1,256}$/.test(meta.headRevisionId ?? "") ||
      !/^[a-f0-9]{32}$/.test(meta.md5Checksum ?? "") || !await insideRoot(target.parent, target.root, signal)) throw unavailable();
  // File.version also changes during Google metadata/thumbnail processing.
  // The binary head revision tracks changes to content, not that processing.
  return { driveVersion: meta.headRevisionId!, md5Checksum: meta.md5Checksum! };
}
const boundedSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);

async function snapshot(media: Photo, signal?: AbortSignal): Promise<Snapshot> {
  const target = photoTarget(media);
  const bounded = boundedSignal(signal);
  const before = await checkedMetadata(target, bounded);
  let source: Readable | undefined;
  try {
    source = (await drive().files.get({ fileId: target.id, alt: "media", supportsAllDrives: true }, { responseType: "stream", signal: bounded })).data;
    const parts: Buffer[] = []; let size = 0;
    for await (const chunk of source) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > target.size || size > MAX_ANONYMOUS_PHOTO_BYTES) throw unavailable();
      parts.push(part);
    }
    if (size !== target.size) throw unavailable();
    const original = Buffer.concat(parts);
    const after = await checkedMetadata(target, bounded);
    const md5Checksum = digest("md5", original);
    if (before.driveVersion !== after.driveVersion || before.md5Checksum !== after.md5Checksum || md5Checksum !== after.md5Checksum) throw unavailable();
    const bytes = anonymousJpeg(original);
    return { bytes, md5Checksum, driveVersion: after.driveVersion, fileChecksum: digest("sha256", original), exportChecksum: digest("sha256", bytes) };
  } catch { throw unavailable(); }
  finally { source?.destroy(); }
}

async function currentPhoto(mediaId: string, options: Options = {}) {
  if (!uuid(mediaId) || (options.patientId !== undefined && !uuid(options.patientId)) || (options.approvalId !== undefined && !uuid(options.approvalId))) throw unavailable();
  const media = await database().media.findUnique({ where: { id: mediaId }, include: anonymousMediaInclude });
  const event = media?.useEvents[0];
  if (!media || (options.patientId && media.session.patientId !== options.patientId) ||
      !eligibleAnonymousMedia(media, event, media.session.patient, media.session) || (options.approvalId && event.id !== options.approvalId)) throw unavailable();
  return { media, event };
}

// Read-only: callers may already hold the shared patient advisory lock. These
// helpers never acquire it or expose source bytes, metadata or audit identities.
export async function verifyAnonymousPhoto(mediaId: string, options: Options = {}) {
  const { media, event } = await currentPhoto(mediaId, options);
  const meta = await checkedMetadata(photoTarget(media), boundedSignal(options.signal));
  if (meta.driveVersion !== event.driveVersion || meta.md5Checksum !== event.md5Checksum) throw unavailable();
  const fresh = await currentPhoto(mediaId, { ...options, approvalId: event.id });
  return fresh.event;
}

export async function anonymousPhotoBytes(mediaId: string, options: Options = {}) {
  const { media, event } = await currentPhoto(mediaId, options);
  const photo = await snapshot(media, options.signal);
  if (photo.driveVersion !== event.driveVersion || photo.md5Checksum !== event.md5Checksum || photo.fileChecksum !== event.fileChecksum || photo.exportChecksum !== event.exportChecksum) throw unavailable();
  await currentPhoto(mediaId, { ...options, approvalId: event.id });
  return { bytes: photo.bytes, eventId: event.id };
}

type Actor = { actor: string; principalHash: string };
type PortalIdentity = Awaited<ReturnType<typeof portalIdentity>>;
const actorFor = (identity: PortalIdentity): Actor => ({ actor: identity.email.toLowerCase(), principalHash: principalHash(`google:${identity.email.toLowerCase()}`) });
function reviewContext(media: Photo, identity: PortalIdentity) {
  return { mediaId: media.id, clinicId: identity.clinic.id, principalHash: actorFor(identity).principalHash,
    patientVersion: media.session.patient.lifecycleVersion, mediaVersion: media.anonymousUseVersion, driveFileId: media.driveFileId };
}
function reviewState(media: Photo, identity: PortalIdentity) {
  const patient = media.session.patient;
  if (media.deletedAt || patient.deletedAt || patient.clinicId !== identity.clinic.id || media.kind !== "photo") throw new UploadError("MEDIA_NOT_FOUND", 404);
  if (patient.archivedAt || patient.consentWithdrawnAt || !media.session.finishedAt) throw new UploadError("ANONYMOUS_APPROVAL_BLOCKED", 409);
}
function readReview(token: unknown, media: Photo, identity: PortalIdentity) {
  const review = typeof token === "string" ? readTicket(token, "anonymous-review") : null;
  if (!review || review.principalHash !== actorFor(identity).principalHash || review.clinicId !== identity.clinic.id) throw new UploadError("ANONYMOUS_REVIEW_REQUIRED", 409);
  if (!matchesAnonymousReview(review, reviewContext(media, identity))) throw new UploadError("ANONYMOUS_REVIEW_STALE", 409);
  return review;
}
async function reviewMedia(mediaId: string, identity: PortalIdentity) {
  if (!uuid(mediaId)) throw new UploadError("MEDIA_NOT_FOUND", 404);
  const media = await database().media.findFirst({ where: { id: mediaId, deletedAt: null, session: { patient: { clinicId: identity.clinic.id, deletedAt: null } } }, include: anonymousMediaInclude });
  if (!media) throw new UploadError("MEDIA_NOT_FOUND", 404);
  reviewState(media, identity);
  return media;
}

export async function createAnonymousReview(mediaId: string, identity: PortalIdentity, signal?: AbortSignal) {
  const media = await reviewMedia(mediaId, identity);
  const photo = await snapshot(media, signal);
  const { bytes: _bytes, ...checksums } = photo;
  const payload = { ...reviewContext(media, identity), ...checksums, policyVersion: ANONYMOUS_USE_TEXT_VERSION, expires: Date.now() + 5 * 60000 };
  const fresh = await reviewMedia(mediaId, identity);
  if (!matchesAnonymousReview(payload, reviewContext(fresh, identity))) throw new UploadError("ANONYMOUS_REVIEW_STALE", 409);
  const reviewToken = signTicket(payload, "anonymous-review");
  return { reviewToken, preview: `/api/media/${mediaId}/anonymous-review?${new URLSearchParams({ review: reviewToken })}` };
}

export async function anonymousReviewBytes(mediaId: string, token: unknown, identity: PortalIdentity, signal?: AbortSignal) {
  const media = await reviewMedia(mediaId, identity);
  const review = readReview(token, media, identity);
  const photo = await snapshot(media, signal);
  const { bytes, ...checksums } = photo;
  if (!matchesAnonymousReview(review, reviewContext(media, identity), checksums)) throw new UploadError("ANONYMOUS_REVIEW_STALE", 409);
  const fresh = await reviewMedia(mediaId, identity);
  readReview(token, fresh, identity);
  return bytes;
}

async function recordEvent(tx: Tx, media: Photo, approved: boolean, operationId: string, actor: Actor, photo?: Snapshot) {
  const version = media.anonymousUseVersion + 1;
  const { bytes: _bytes, ...checksums } = photo ?? { bytes: undefined };
  await tx.media.update({ where: { id: media.id }, data: { anonymousUseVersion: version } });
  await tx.mediaUseEvent.create({ data: {
    mediaId: media.id, version, action: approved ? "approved" : "revoked", operationId,
    actor: actor.actor, principalHash: actor.principalHash, policyText: ANONYMOUS_USE_TEXT,
    policyTextVersion: ANONYMOUS_USE_TEXT_VERSION, patientVersion: media.session.patient.lifecycleVersion,
    ...(approved ? checksums : {}),
  } });
  // Old links remain bound to their original approval and cannot silently regain
  // access after a new review. Revoke them explicitly for a clear audit trail.
  await tx.shareLink.updateMany({ where: { mode: "anonymous", revokedAt: null, photos: { some: { mediaId: media.id } } }, data: { revokedAt: new Date() } });
}

export async function setAnonymousUse(mediaId: string, identity: PortalIdentity, input: { approved: boolean; requestId: string; reviewToken?: string }) {
  const db = database();
  const initial = await db.media.findFirst({ where: { id: mediaId, deletedAt: null, session: { patient: { clinicId: identity.clinic.id, deletedAt: null } } }, select: { session: { select: { patientId: true } } } });
  if (!initial) throw new UploadError("MEDIA_NOT_FOUND", 404);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`patient:${initial.session.patientId}`}))`;
    const media = await tx.media.findUniqueOrThrow({ where: { id: mediaId }, include: anonymousMediaInclude });
    const patient = media.session.patient;
    if (media.deletedAt || patient.deletedAt || patient.clinicId !== identity.clinic.id || media.kind !== "photo") throw new UploadError("MEDIA_NOT_FOUND", 404);
    const actor = actorFor(identity);
    const previous = await tx.mediaUseEvent.findUnique({ where: { operationId: input.requestId } });
    if (previous) {
      if (previous.mediaId !== mediaId || previous.action !== (input.approved ? "approved" : "revoked") || previous.principalHash !== actor.principalHash) throw new UploadError("ANONYMOUS_APPROVAL_CONFLICT", 409);
      return { approved: eligibleAnonymousMedia(media, media.useEvents[0], patient, media.session) };
    }
    let photo: Snapshot | undefined;
    if (input.approved) {
      reviewState(media, identity);
      const review = readReview(input.reviewToken, media, identity);
      photo = await snapshot(media);
      const { bytes: _bytes, ...checksums } = photo;
      if (!matchesAnonymousReview(review, reviewContext(media, identity), checksums)) throw new UploadError("ANONYMOUS_REVIEW_STALE", 409);
      // A request that finishes after its five-minute review window must refresh
      // the preview, even when the current bytes still happen to match.
      readReview(input.reviewToken, media, identity);
    }
    await recordEvent(tx, media, input.approved, input.requestId, actor, photo);
    return { approved: input.approved };
  }, { timeout: 60000, maxWait: 10000 });
}

// Called inside confirmFile's batch → patient transaction. A stable operation
// UUID deduplicates the same file confirmation without trusting a client ID to
// be globally unique across uploads or dashboard actions.
export async function recordUploadAnonymousApproval(tx: Tx, mediaId: string, file: FilePlan, identity: { email: string | null; principalHash: string }) {
  if (!file.anonymousApproved) return false;
  const media = await tx.media.findUniqueOrThrow({ where: { id: mediaId }, include: anonymousMediaInclude });
  if (file.anonymousPolicyVersion !== ANONYMOUS_USE_TEXT_VERSION || media.kind !== "photo") throw new UploadError("INVALID_ANONYMOUS_APPROVAL");
  const patient = media.session.patient;
  // Withdrawal never blocks private storage and is never bypassed by this
  // checkbox. Staff can review again only after the lifecycle restriction ends.
  if (patient.consentWithdrawnAt || patient.archivedAt || patient.deletedAt || file.anonymousPatientVersion !== patient.lifecycleVersion) return false;
  const hash = digest("sha256", Buffer.from(`anonymous-upload:${media.session.uploadId}:${file.key}`));
  const operationId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const previous = await tx.mediaUseEvent.findUnique({ where: { operationId } });
  if (previous) {
    if (previous.mediaId !== media.id || previous.principalHash !== identity.principalHash) throw new UploadError("ANONYMOUS_APPROVAL_CONFLICT", 409);
    return previous.action === "approved";
  }
  const photo = await snapshot(media);
  if (photo.fileChecksum !== file.contentChecksum) return false;
  await recordEvent(tx, media, true, operationId, { actor: identity.email ?? media.session.uploadedBy, principalHash: identity.principalHash }, photo);
  return true;
}
