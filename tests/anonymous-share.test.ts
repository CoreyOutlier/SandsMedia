import test from "node:test";
import assert from "node:assert/strict";
import { anonymousPhotoName, anonymousShareData, validAnonymousSelection } from "../src/lib/portal/anonymous-share.ts";

const id = "00000000-0000-4000-8000-000000000001";

test("anonymous share DTO exposes only its fixed photo selection and generic labels", () => {
  const patientSecret = "SECRET_PATIENT_NAME";
  const sessionSecret = "SECRET_SESSION_ID";
  const source = { mediaId: id, position: 1, patientId: patientSecret, sessionId: sessionSecret, fileName: "secret-file.jpg", title: "Secret title", treatment: "Secret treatment", notes: "Secret notes", date: "1999-01-01", uploadedBy: "Secret uploader", quote: "Secret quote" };
  const link = { id: "opaque-link-id", expiresAt: new Date("2026-11-12T00:00:00Z"), patient: { name: patientSecret } };
  const result = anonymousShareData(link, [source], "signed-ticket");
  assert.deepEqual(Object.keys(result), ["mode", "expiresAt", "download", "photos"]);
  assert.deepEqual(Object.keys(result.photos[0]), ["id", "title", "thumbnail", "stream", "download"]);
  assert.equal(result.photos[0].title, "Photo 02");
  assert.equal(result.photos[0].id, id);
  assert.equal(result.photos.length, 1);
  const serialized = JSON.stringify(result);
  for (const secret of [patientSecret, sessionSecret, "secret-file", "Secret title", "Secret treatment", "Secret notes", "1999-01-01", "Secret uploader", "Secret quote"]) assert.equal(serialized.includes(secret), false);
});

test("anonymous filenames are generic and preserve selection order", () => {
  assert.equal(anonymousPhotoName(0), "photo-01.jpg");
  assert.equal(anonymousPhotoName(99), "photo-100.jpg");
});

test("anonymous shares require one to 100 explicit unique media UUIDs", () => {
  assert.equal(validAnonymousSelection([id]), true);
  for (const value of [undefined, null, [], id, [id, id], ["patient-name"], [1], Array(101).fill(id)]) assert.equal(validAnonymousSelection(value), false);
});
