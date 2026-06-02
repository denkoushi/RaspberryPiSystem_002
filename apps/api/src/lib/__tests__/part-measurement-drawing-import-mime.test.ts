import { describe, expect, it } from 'vitest';

import {
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  resolveDrawingMime
} from '../part-measurement-drawing-import-mime.js';
import {
  PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES,
  PART_MEASUREMENT_PDF_INPUT_MAX_BYTES
} from '../part-measurement-drawing-import.constants.js';

describe('part-measurement-drawing-import-mime', () => {
  it('classifies png and pdf', () => {
    expect(classifyDrawingUpload('image/png', 'a.png')).toBe('image');
    expect(classifyDrawingUpload('application/pdf', 'a.pdf')).toBe('pdf');
    expect(classifyDrawingUpload('application/octet-stream', 'a.pdf')).toBe('pdf');
  });

  it('resolves jpeg alias', () => {
    expect(resolveDrawingMime('image/jpg', 'x.jpg')).toBe('image/jpeg');
  });

  it('uses separate input limits', () => {
    expect(getDrawingInputMaxBytes('image')).toBe(PART_MEASUREMENT_IMAGE_INPUT_MAX_BYTES);
    expect(getDrawingInputMaxBytes('pdf')).toBe(PART_MEASUREMENT_PDF_INPUT_MAX_BYTES);
  });
});
