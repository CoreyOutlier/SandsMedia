import test from "node:test";
import assert from "node:assert/strict";
import { downloadDisposition } from "../src/lib/portal/download.ts";

test("downloads retain Unicode titles with an ASCII attachment fallback", () => {
  const header = downloadDisposition("testimonial-01 - Révélation 😀.mp4");
  assert.match(header, /^attachment; filename="[a-zA-Z0-9_.-]+"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(header.split("filename*=UTF-8''")[1]), "testimonial-01 - Révélation 😀.mp4");
});
test("download filenames cannot create header lines, paths, or quoted parameters", () => {
  const header = downloadDisposition('../clip\r\n";evil=.mp4');
  assert.equal(/[\r\n]/.test(header), false);
  const raw = decodeURIComponent(header.split("filename*=UTF-8''")[1]);
  assert.equal(/[\\/]/.test(raw), false);
  assert.equal(raw.startsWith("."), false);
  assert.match(header, /^attachment; filename="[a-zA-Z0-9_.-]+"; filename\*=UTF-8''/);
  assert.ok(downloadDisposition("patient's clip (final).mp4").includes("%27"));
});
test("malformed or empty titles still produce a valid attachment header", () => {
  assert.doesNotThrow(() => downloadDisposition("bad\uD800.mp4"));
  assert.ok(downloadDisposition("").includes('filename="media"'));
});
