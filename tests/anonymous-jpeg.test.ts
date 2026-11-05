import test from "node:test";
import assert from "node:assert/strict";
import { anonymousJpeg, MAX_ANONYMOUS_PHOTO_BYTES, UnsafeJpegError } from "../src/lib/portal/jpeg.ts";

const segment = (marker: number, payload: Uint8Array) => {
  const length = Buffer.alloc(2); length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};
const frame = (progressive = false) => segment(progressive ? 0xc2 : 0xc0, Buffer.from([8, 0, 10, 0, 12, 1, 1, 0x11, 0]));
const scan = () => segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
const soi = Buffer.from([0xff, 0xd8]);
const eoi = Buffer.from([0xff, 0xd9]);
const entropy = Buffer.from([1, 2, 0xff, 0, 3, 0xff, 0xd0, 4]);
const plain = () => Buffer.concat([soi, frame(), scan(), entropy, eoi]);

test("anonymous JPEG exports strip every APP/comment segment and trailing payload", () => {
  const metadata = [...Array(16)].map((_, index) => segment(0xe0 + index, Buffer.from(`private-metadata-${index}`)));
  metadata.push(segment(0xfe, Buffer.from("private comment")));
  const input = Buffer.concat([soi, ...metadata, frame(), scan(), entropy, eoi, Buffer.from("private trailing payload")]);
  assert.deepEqual(anonymousJpeg(input), plain());
  assert.equal(anonymousJpeg(input).includes(Buffer.from("private")), false);
});

test("progressive scans strip intervening metadata without losing stuffed bytes or restart markers", () => {
  const input = Buffer.concat([soi, frame(true), scan(), entropy, segment(0xe1, Buffer.from("hidden EXIF")), segment(0xfe, Buffer.from("hidden comment")), scan(), entropy, eoi]);
  assert.deepEqual(anonymousJpeg(input), Buffer.concat([soi, frame(true), scan(), entropy, scan(), entropy, eoi]));
  assert.deepEqual(anonymousJpeg(anonymousJpeg(input)), anonymousJpeg(input));
});

test("anonymous JPEG exports fail closed on incomplete or unsupported structures", () => {
  const invalid = [Buffer.from("not a JPEG"), Buffer.concat([soi, eoi]), plain().subarray(0, -1), Buffer.concat([soi, segment(0xe1, Buffer.from("private")), eoi]), Buffer.concat([soi, segment(0xc3, Buffer.alloc(11)), scan(), entropy, eoi]), Buffer.concat([soi, Buffer.from([0xff, 0xe1, 0xff, 0xff]), eoi]), Buffer.concat([soi, frame(), scan(), Buffer.from([1, 0xff])])];
  for (const value of invalid) assert.throws(() => anonymousJpeg(value), UnsafeJpegError);
  assert.throws(() => anonymousJpeg(Buffer.alloc(MAX_ANONYMOUS_PHOTO_BYTES + 1)), UnsafeJpegError);
  const tooWide = plain(); tooWide.writeUInt16BE(2049, 9);
  assert.throws(() => anonymousJpeg(tooWide), UnsafeJpegError);
});
