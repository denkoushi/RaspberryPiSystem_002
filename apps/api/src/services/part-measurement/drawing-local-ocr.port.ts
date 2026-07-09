import type { PartMeasurementDrawingOcrToken } from './part-measurement-drawing-ocr-payload.js';

export type DrawingLocalOcrRequest = {
  imageBytes: Buffer;
  xRatio: number;
  yRatio: number;
  /** Expand ROI for depth callouts (深サN) near the marker. */
  depthSearch?: boolean;
};

/**
 * Request-time marker-local OCR. Separate from full-drawing cache engine
 * so RapidOCR/DGX can be swapped later without changing cache contracts.
 */
export interface DrawingLocalOcrPort {
  runLocalOcr(input: DrawingLocalOcrRequest): Promise<PartMeasurementDrawingOcrToken[]>;
}
