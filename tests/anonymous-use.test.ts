import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ANONYMOUS_USE_TEXT_VERSION, eligibleAnonymousMedia, matchesAnonymousReview } from "../src/lib/anonymous-use.ts";
import { UploadError, validateStart } from "../src/lib/upload/validation.ts";

function fixture() {
  const media = { id: randomUUID(), kind: "photo", anonymousUseVersion: 2, deletedAt: null };
  const event = { id: randomUUID(), mediaId: media.id, version: 2, action: "approved", policyTextVersion: ANONYMOUS_USE_TEXT_VERSION, patientVersion: 3, fileChecksum: "a".repeat(64), exportChecksum: "b".repeat(64), driveVersion: "opaque_head-revision_4", md5Checksum: "c".repeat(32) };
  return { media, event, patient: { lifecycleVersion: 3, consentWithdrawnAt: null, archivedAt: null, deletedAt: null }, session: { finishedAt: new Date() } };
}

test("anonymous approval requires the latest per-photo event, current policy and patient lifecycle", () => {
  const { media, event, patient, session } = fixture();
  assert.equal(eligibleAnonymousMedia(media, event, patient, session), true);
  for (const changed of [{ version: 1 }, { action: "revoked" }, { mediaId: randomUUID() }, { policyTextVersion: 0 }, { patientVersion: 2 }]) {
    assert.equal(eligibleAnonymousMedia(media, { ...event, ...changed }, patient, session), false);
  }
  assert.equal(eligibleAnonymousMedia(media, undefined, patient, session), false);
  assert.equal(eligibleAnonymousMedia({ ...media, anonymousUseVersion: 3 }, event, patient, session), false);
});

test("anonymous approval never clears video, unfinished uploads, deleted media or restricted patients", () => {
  const { media, event, patient, session } = fixture();
  assert.equal(eligibleAnonymousMedia({ ...media, kind: "video" }, event, patient, session), false);
  assert.equal(eligibleAnonymousMedia({ ...media, deletedAt: new Date() }, event, patient, session), false);
  assert.equal(eligibleAnonymousMedia(media, event, patient, { finishedAt: null }), false);
  for (const changed of [{ lifecycleVersion: 4 }, { consentWithdrawnAt: new Date() }, { archivedAt: new Date() }, { deletedAt: new Date() }]) {
    assert.equal(eligibleAnonymousMedia(media, event, { ...patient, ...changed }, session), false);
  }
  // Restoring a patient does not resurrect an older version's approval.
  assert.equal(eligibleAnonymousMedia(media, event, { ...patient, lifecycleVersion: 5 }, session), false);
});

test("anonymous approval requires complete content and export digests", () => {
  const { media, event, patient, session } = fixture();
  for (const changed of [{ fileChecksum: null }, { fileChecksum: "a".repeat(63) }, { exportChecksum: null }, { exportChecksum: "not a digest" }, { driveVersion: null }, { driveVersion: "has spaces" }, { driveVersion: "a".repeat(257) }, { md5Checksum: null }, { md5Checksum: "c".repeat(31) }]) {
    assert.equal(eligibleAnonymousMedia(media, { ...event, ...changed }, patient, session), false);
  }
});

const photo = () => ({ key: randomUUID(), fingerprint: "a".repeat(64), contentChecksum: "b".repeat(64), kind: "photo", label: "other", mimeType: "image/jpeg", bytes: 200, width: 200, height: 100, durationS: null });
const upload = () => ({ uploadId: randomUUID(), kind: "patient", firstName: "Synthetic", lastName: "Review", treatment: "Synthetic session", date: "2026-11-05", description: "", uploadedBy: "Synthetic operator", consented: false, formOnFile: false, files: [photo()] });

test("uploading without written consent stays private unless a photo has an explicit current policy review", () => {
  const input = upload();
  const privateUpload = validateStart(input, 500);
  assert.equal(privateUpload.files[0].anonymousApproved, false);
  assert.equal(privateUpload.files[0].anonymousPolicyVersion, undefined);
  const mixed = validateStart({ ...input, policyVersion: ANONYMOUS_USE_TEXT_VERSION, files: [{ ...photo(), anonymousApproved: true }, photo()] }, 500);
  assert.equal(mixed.consented, false);
  assert.equal(mixed.formOnFile, false);
  assert.deepEqual(mixed.files.map(f => f.anonymousApproved), [true, false]);
  assert.equal(mixed.files[0].anonymousPolicyVersion, ANONYMOUS_USE_TEXT_VERSION);
  assert.equal(mixed.files[0].contentChecksum, "b".repeat(64));
  const forged = validateStart({ ...input, policyVersion: 1, files: [{ ...photo(), anonymousApproved: true, anonymousPatientVersion: 123 }] }, 500);
  assert.equal(forged.files[0].anonymousPatientVersion, undefined);
});

test("anonymous upload review rejects coerced flags, old policy, general footage and videos", () => {
  const input = upload();
  const rejected = (value: unknown) => assert.throws(() => validateStart(value, 500), (error: unknown) => error instanceof UploadError && error.code === "INVALID_ANONYMOUS_APPROVAL");
  for (const flag of ["true", 1, null, {}]) rejected({ ...input, policyVersion: 1, files: [{ ...photo(), anonymousApproved: flag }] });
  for (const policyVersion of [undefined, 0, "1", 2]) rejected({ ...input, policyVersion, files: [{ ...photo(), anonymousApproved: true }] });
  rejected({ ...input, kind: "general", title: "Synthetic footage", policyVersion: 1, files: [{ ...photo(), anonymousApproved: true }] });
  rejected({ ...input, policyVersion: 1, files: [{ ...photo(), kind: "video", mimeType: "video/mp4", durationS: 1, anonymousApproved: true }] });
  rejected({ ...input, policyVersion: 1, files: [{ ...photo(), contentChecksum: undefined, anonymousApproved: true }] });
});

test("signed review context binds staff, clinic, media, lifecycle, approval version and exact snapshot", () => {
  const context = { mediaId: randomUUID(), clinicId: randomUUID(), principalHash: "staff-hash", patientVersion: 2, mediaVersion: 3, driveFileId: "synthetic-file" };
  const snapshot = { fileChecksum: "a".repeat(64), exportChecksum: "b".repeat(64), driveVersion: "opaque-revision", md5Checksum: "c".repeat(32) };
  const review = { ...context, ...snapshot, policyVersion: ANONYMOUS_USE_TEXT_VERSION };
  assert.equal(matchesAnonymousReview(review, context, snapshot), true);
  for (const [key, value] of Object.entries(context)) {
    assert.equal(matchesAnonymousReview({ ...review, [key]: typeof value === "number" ? value + 1 : `${value}-different` }, context, snapshot), false);
  }
  for (const changed of [{ fileChecksum: "d".repeat(64) }, { exportChecksum: "d".repeat(64) }, { driveVersion: "new-revision" }, { md5Checksum: "d".repeat(32) }]) {
    assert.equal(matchesAnonymousReview(review, context, { ...snapshot, ...changed }), false);
  }
  assert.equal(matchesAnonymousReview({ ...review, policyVersion: 0 }, context, snapshot), false);
  assert.equal(matchesAnonymousReview({ ...review, fileChecksum: undefined }, context), false);
});
