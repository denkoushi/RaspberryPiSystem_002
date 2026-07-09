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
 * so RapidOCR (secondary) / future engines can be swapped without changing
 * cache contracts. Orchestration of primary vs secondary lives in the service.
 */
export interface DrawingLocalOcrPort {
  runLocalOcr(input: DrawingLocalOcrRequest): Promise<PartMeasurementDrawingOcrToken[]>;
}
