import { describe, expect, it } from 'vitest';

import {
  isPartMeasurementDrawingPdfFile,
  partMeasurementDrawingPreviewJpegFile
} from './partMeasurementDrawingLocalPreview';

describe('partMeasurementDrawingLocalPreview', () => {
  describe('isPartMeasurementDrawingPdfFile', () => {
    it('detects application/pdf mime', () => {
      const file = new File([new Uint8Array([1])], 'drawing.pdf', { type: 'application/pdf' });
      expect(isPartMeasurementDrawingPdfFile(file)).toBe(true);
    });

    it('detects .pdf extension when mime is empty', () => {
      const file = new File([new Uint8Array([1])], 'drawing.pdf', { type: '' });
      expect(isPartMeasurementDrawingPdfFile(file)).toBe(true);
    });

    it('returns false for png', () => {
      const file = new File([new Uint8Array([1])], 'drawing.png', { type: 'image/png' });
      expect(isPartMeasurementDrawingPdfFile(file)).toBe(false);
    });
  });

  describe('partMeasurementDrawingPreviewJpegFile', () => {
    it('creates jpeg File from blob with pdf name replaced', () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
      const file = partMeasurementDrawingPreviewJpegFile(blob, 'TM1-0001684310.pdf');
      expect(file.name).toBe('TM1-0001684310.jpg');
      expect(file.type).toBe('image/jpeg');
    });
  });
});
