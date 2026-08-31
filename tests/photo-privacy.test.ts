import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPrivacySafeJpeg, jpegContainsExif } from '../src/services/media/jpeg-privacy';

function jpegWithSegment(marker: number, payload: readonly number[]): Uint8Array {
  const length = payload.length + 2;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    marker,
    (length >> 8) & 0xff,
    length & 0xff,
    ...payload,
    0xff,
    0xd9,
  ]);
}

test('EXIF APP1 metadata is rejected before a photo can enter a draft', () => {
  const bytes = jpegWithSegment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2]);
  assert.equal(jpegContainsExif(bytes), true);
  assert.throws(() => assertPrivacySafeJpeg(bytes), /EXIF metadata/);
});

test('ordinary JPEG application metadata is allowed when no EXIF signature remains', () => {
  const bytes = jpegWithSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]);
  assert.equal(jpegContainsExif(bytes), false);
  assert.doesNotThrow(() => assertPrivacySafeJpeg(bytes));
});

test('malformed and non-JPEG inputs are never accepted as processed photos', () => {
  assert.equal(jpegContainsExif(Uint8Array.from([1, 2, 3])), false);
  assert.throws(() => assertPrivacySafeJpeg(Uint8Array.from([1, 2, 3])), /valid JPEG/);
});
