// This approval records a staff review under the clinic's policy. It is never
// patient consent and must not create or alter a ConsentEvent.
export const ANONYMOUS_USE_TEXT_VERSION = 1;
export const ANONYMOUS_USE_TEXT = "I reviewed this dental close-up under the clinic’s approved anonymous-use policy. It has no full face, names, dates, distinctive identifying features, or other details that could identify the patient.";

export type AnonymousPatientState = {
  lifecycleVersion: number;
  consentWithdrawnAt: unknown;
  archivedAt?: unknown;
  deletedAt?: unknown;
};

export type AnonymousApprovalState = {
  id: string;
  mediaId: string;
  version: number;
  action: string;
  policyTextVersion: number;
  patientVersion: number;
  fileChecksum: string | null;
  exportChecksum: string | null;
  driveVersion: string | null;
  md5Checksum: string | null;
};

export function eligibleAnonymousMedia(
  media: { id: string; kind: string; anonymousUseVersion: number; deletedAt?: unknown },
  approval: AnonymousApprovalState | null | undefined,
  patient: AnonymousPatientState,
  session: { finishedAt: unknown },
): approval is AnonymousApprovalState {
  return !!approval && approval.mediaId === media.id && approval.version === media.anonymousUseVersion &&
    approval.action === "approved" && approval.policyTextVersion === ANONYMOUS_USE_TEXT_VERSION &&
    approval.patientVersion === patient.lifecycleVersion && !patient.consentWithdrawnAt && !patient.archivedAt && !patient.deletedAt &&
    !!session.finishedAt && !media.deletedAt && media.kind === "photo" &&
    /^[a-f0-9]{64}$/.test(approval.fileChecksum ?? "") && /^[a-f0-9]{64}$/.test(approval.exportChecksum ?? "") &&
    /^[A-Za-z0-9_-]{1,256}$/.test(approval.driveVersion ?? "") && /^[a-f0-9]{32}$/.test(approval.md5Checksum ?? "");
}

export type AnonymousReviewContext = {
  mediaId: string; clinicId: string; principalHash: string; patientVersion: number;
  mediaVersion: number; driveFileId: string;
};
export type AnonymousReviewSnapshot = {
  fileChecksum: string; exportChecksum: string; driveVersion: string; md5Checksum: string;
};
export function matchesAnonymousReview(review: Record<string, unknown>, context: AnonymousReviewContext, photo?: AnonymousReviewSnapshot) {
  if (review.policyVersion !== ANONYMOUS_USE_TEXT_VERSION || Object.entries(context).some(([key, value]) => review[key] !== value)) return false;
  if (typeof review.fileChecksum !== "string" || !/^[a-f0-9]{64}$/.test(review.fileChecksum) ||
      typeof review.exportChecksum !== "string" || !/^[a-f0-9]{64}$/.test(review.exportChecksum) ||
      typeof review.driveVersion !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(review.driveVersion) ||
      typeof review.md5Checksum !== "string" || !/^[a-f0-9]{32}$/.test(review.md5Checksum)) return false;
  return !photo || Object.entries(photo).every(([key, value]) => review[key] === value);
}
