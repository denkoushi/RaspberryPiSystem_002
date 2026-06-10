import { describe, expect, it } from 'vitest';

import {
  assertTiffMagic,
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  resolveDrawingMime
} from '../part-measurement-drawing-import-mime.js';
import {
  PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES,
  PART_MEASUREMENT_PDF_INPUT_MAX_BYTES,
  PART_MEASUREMENT_TIFF_INPUT_MAX_BYTES
} from '../part-measurement-drawing-import.constants.js';

describe('part-measurement-drawing-import-mime', () => {
  it('classifies png, pdf, and tiff', () => {
    expect(classifyDrawingUpload('image/png', 'a.png')).toBe('image');
    expect(classifyDrawingUpload('application/pdf', 'a.pdf')).toBe('pdf');
    expect(classifyDrawingUpload('application/octet-stream', 'a.pdf')).toBe('pdf');
    expect(classifyDrawingUpload('image/tiff', 'a.tiff')).toBe('tiff');
    expect(classifyDrawingUpload('image/x-tiff', 'a.tif')).toBe('tiff');
    expect(classifyDrawingUpload('application/octet-stream', 'a.tif')).toBe('tiff');
  });

  it('resolves jpeg alias', () => {
    expect(resolveDrawingMime('image/jpg', 'x.jpg')).toBe('image/jpeg');
  });

  it('uses separate input limits', () => {
    expect(getDrawingInputMaxBytes('image')).toBe(PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES);
    expect(getDrawingInputMaxBytes('pdf')).toBe(PART_MEASUREMENT_PDF_INPUT_MAX_BYTES);
    expect(getDrawingInputMaxBytes('tiff')).toBe(PART_MEASUREMENT_TIFF_INPUT_MAX_BYTES);
  });

  it('validates tiff magic bytes', () => {
    const le = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08]);
    const be = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00]);
    expect(() => assertTiffMagic(le)).not.toThrow();
    expect(() => assertTiffMagic(be)).not.toThrow();
    expect(() => assertTiffMagic(Buffer.from('%PDF-'))).toThrow();
  });
});
