import { describe, expect, it } from 'vitest';

import {
  isPartMeasurementDrawingPdfFile,
  isPartMeasurementDrawingPreviewConversionFile,
  isPartMeasurementDrawingTiffFile,
  partMeasurementDrawingPreviewConvertingLabel,
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

  describe('isPartMeasurementDrawingTiffFile', () => {
    it('detects image/tiff mime', () => {
      const file = new File([new Uint8Array([1])], 'drawing.tiff', { type: 'image/tiff' });
      expect(isPartMeasurementDrawingTiffFile(file)).toBe(true);
    });

    it('detects .tif extension when mime is empty', () => {
      const file = new File([new Uint8Array([1])], 'drawing.tif', { type: '' });
      expect(isPartMeasurementDrawingTiffFile(file)).toBe(true);
    });
  });

  describe('isPartMeasurementDrawingPreviewConversionFile', () => {
    it('returns true for pdf and tiff', () => {
      expect(
        isPartMeasurementDrawingPreviewConversionFile(
          new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })
        )
      ).toBe(true);
      expect(
        isPartMeasurementDrawingPreviewConversionFile(
          new File([new Uint8Array([1])], 'a.tif', { type: 'image/tiff' })
        )
      ).toBe(true);
      expect(
        isPartMeasurementDrawingPreviewConversionFile(
          new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
        )
      ).toBe(false);
    });
  });

  describe('partMeasurementDrawingPreviewConvertingLabel', () => {
    it('returns tiff or pdf label', () => {
      expect(
        partMeasurementDrawingPreviewConvertingLabel(
          new File([new Uint8Array([1])], 'a.tif', { type: 'image/tiff' })
        )
      ).toBe('TIFF を変換中…');
      expect(
        partMeasurementDrawingPreviewConvertingLabel(
          new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })
        )
      ).toBe('PDF を変換中…');
    });
  });

  describe('partMeasurementDrawingPreviewJpegFile', () => {
    it('creates jpeg File from blob with pdf name replaced', () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
      const file = partMeasurementDrawingPreviewJpegFile(blob, 'TM1-0001684310.pdf');
      expect(file.name).toBe('TM1-0001684310.jpg');
      expect(file.type).toBe('image/jpeg');
    });

    it('creates jpeg File from blob with tiff name replaced', () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
      const file = partMeasurementDrawingPreviewJpegFile(blob, 'drawing.tiff');
      expect(file.name).toBe('drawing.jpg');
    });
  });
});
