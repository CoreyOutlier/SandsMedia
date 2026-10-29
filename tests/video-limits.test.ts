import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateStart } from "../src/lib/upload/validation.ts";
import { MAX_VIDEO_MB, MAX_VIDEO_SECONDS, validVideoDuration } from "../src/lib/upload/limits.ts";
import { fileSize, mediaDuration } from "../src/lib/media-format.ts";

function batch(kind = "patient", bytes = MAX_VIDEO_MB * 1024 ** 2, durationS = MAX_VIDEO_SECONDS) {
  return { uploadId: randomUUID(), kind, firstName: "Synthetic", lastName: "Fixture", treatment: "Test", title: "Test footage", date: "2026-10-29", description: "", uploadedBy: "Test", consented: false, formOnFile: false,
    files: [{ key: randomUUID(), fingerprint: "a".repeat(64), kind: "video", label: "other", mimeType: "video/mp4", bytes, width: 1920, height: 1080, durationS }] };
}
test("both libraries accept exactly 5 GB and two hours, reject either limit exceeded", () => {
  for (const kind of ["patient", "general"]) {
    const accepted = validateStart(batch(kind), MAX_VIDEO_MB).files[0];
    assert.equal(accepted.bytes, 5368709120);
    assert.equal(accepted.durationS, 7200);
    assert.throws(() => validateStart(batch(kind, accepted.bytes + 1), MAX_VIDEO_MB), /FILE_TOO_LARGE/);
    assert.throws(() => validateStart(batch(kind, accepted.bytes, 7200.001), MAX_VIDEO_MB), /VIDEO_TOO_LONG/);
    assert.equal(validateStart(batch(kind, 600 * 1024 ** 2, 3601), MAX_VIDEO_MB).files[0].durationS, 3601);
  }
});
test("duration metadata must remain positive and finite", () => {
  for (const duration of [0, -1, NaN, Infinity, -Infinity, null, undefined, "7200"]) {
    assert.equal(validVideoDuration(duration), false);
    assert.throws(() => validateStart({ ...batch(), files: [{ ...batch().files[0], durationS: duration }] }, MAX_VIDEO_MB), /VIDEO_TOO_LONG/);
  }
  assert.equal(validVideoDuration(0.001), true);
  assert.equal(validVideoDuration(7200), true);
});
test("configured size caps remain enforced and cannot exceed the chosen maximum", () => {
  assert.throws(() => validateStart(batch(), 500), /FILE_TOO_LARGE/);
  for (const cap of [NaN, Infinity, 0, -1, 5121]) assert.throws(() => validateStart(batch(), cap), /UPLOAD_SETUP_REQUIRED/);
});
test("large media sizes and hour-length durations display clearly", () => {
  assert.equal(fileSize(5 * 1024 ** 3), "5 GB");
  assert.equal(fileSize(1.5 * 1024 ** 3), "1.5 GB");
  assert.equal(fileSize(500 * 1024 ** 2), "500.0 MB");
  assert.equal(mediaDuration(59.99), "0:59");
  assert.equal(mediaDuration(3601), "1:00:01");
  assert.equal(mediaDuration(7200), "2:00:00");
});
