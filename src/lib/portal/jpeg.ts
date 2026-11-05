// Anonymous exports keep only the JPEG coding data. All APP segments (EXIF,
// GPS, XMP, IPTC, ICC and vendor extensions), comments and bytes after EOI are
// discarded. This is a bounded parser, not an image or identity classifier.
export const MAX_ANONYMOUS_PHOTO_BYTES = 20 * 1024 * 1024;

export class UnsafeJpegError extends Error {
  constructor() { super("ANONYMOUS_PHOTO_UNAVAILABLE"); }
}

export function anonymousJpeg(input: Uint8Array): Buffer {
  const fail = (): never => { throw new UnsafeJpegError(); };
  if (input.length < 4 || input.length > MAX_ANONYMOUS_PHOTO_BYTES || input[0] !== 0xff || input[1] !== 0xd8) fail();
  const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const parts: Buffer[] = [source.subarray(0, 2)];
  let at = 2;
  let frame = false;
  let components = 0;
  let scans = 0;
  let segments = 0;
  while (at < source.length) {
    if (++segments > 4096) fail();
    if (source[at++] !== 0xff) fail();
    // JPEG permits marker-fill bytes. Do not copy arbitrary padding forward.
    while (source[at] === 0xff) at++;
    if (at >= source.length) fail();
    const marker = source[at++];
    if (marker === 0xd9) {
      if (!frame || !scans) fail();
      parts.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(parts);
    }
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) fail();
    if (at + 2 > source.length) fail();
    const length = source.readUInt16BE(at);
    if (length < 2 || at + length > source.length) fail();
    const end = at + length;
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    // Only baseline/extended-sequential/progressive Huffman JPEG is accepted.
    // Unknown extensions fail closed instead of preserving opaque payloads.
    if (!metadata && ![0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xda].includes(marker)) fail();
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (frame || length < 11 || source[at + 2] !== 8) fail();
      const height = source.readUInt16BE(at + 3);
      const width = source.readUInt16BE(at + 5);
      components = source[at + 7];
      if (!height || !width || height > 2048 || width > 2048 || ![1, 3, 4].includes(components) || length !== 8 + 3 * components) fail();
      frame = true;
    }
    if (marker === 0xc4 && length < 19) fail();
    if (marker === 0xdb && length < 67) fail();
    if (marker === 0xdd && length !== 4) fail();
    if (marker === 0xda) {
      if (!frame || length < 8 || source[at + 2] > components || length !== 6 + 2 * source[at + 2] || ++scans > 256) fail();
    }
    if (!metadata) parts.push(Buffer.from([0xff, marker]), source.subarray(at, end));
    at = end;
    if (marker !== 0xda) continue;

    // A progressive JPEG can have several entropy-coded scans separated by
    // coding tables or metadata. Preserve stuffed FF bytes/restart markers;
    // return to segment parsing at every other marker, including APP/COM.
    const start = at;
    while (at < source.length) {
      if (source[at] !== 0xff) { at++; continue; }
      let next = at + 1;
      while (source[next] === 0xff) next++;
      if (next >= source.length) fail();
      if (source[next] === 0x00 || (source[next] >= 0xd0 && source[next] <= 0xd7)) { at = next + 1; continue; }
      break;
    }
    if (at >= source.length || at === start) fail();
    parts.push(source.subarray(start, at));
  }
  return fail();
}
