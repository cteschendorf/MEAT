/**
 * Returns true when a JPEG contains an APP1 segment with an Exif signature.
 * MEAT re-encodes every selected photo and uses this as a final privacy gate
 * before the derivative can enter a draft.
 */
export function jpegContainsExif(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;

    const segmentLength = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const dataStart = offset + 2;
    if (
      marker === 0xe1 &&
      segmentLength >= 8 &&
      bytes[dataStart] === 0x45 &&
      bytes[dataStart + 1] === 0x78 &&
      bytes[dataStart + 2] === 0x69 &&
      bytes[dataStart + 3] === 0x66 &&
      bytes[dataStart + 4] === 0x00 &&
      bytes[dataStart + 5] === 0x00
    ) {
      return true;
    }
    offset += segmentLength;
  }
  return false;
}

export function assertPrivacySafeJpeg(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('The processed photo is not a valid JPEG.');
  }
  if (jpegContainsExif(bytes)) {
    throw new Error('The processed photo still contains EXIF metadata.');
  }
}
