import sharp from 'sharp';

import {
  DRAWING_LOCAL_OCR_ROTATIONS,
  listLocalOcrRects,
  mapBboxToOriginalRatios,
  renderLocalOcrPass,
  withTimeout
} from './drawing-local-ocr-crop.js';
import type { DrawingLocalOcrPort, DrawingLocalOcrRequest } from './drawing-local-ocr.port.js';
import {
  getDrawingLocalRapidOcrWorkerClient,
  readRapidOcrTimeoutMs,
  type DrawingLocalRapidOcrWorkerClient
} from './drawing-local-rapidocr-worker.client.js';
import type { PartMeasurementDrawingOcrToken } from './part-measurement-drawing-ocr-payload.js';

export class DrawingLocalOcrRapidOcrAdapter implements DrawingLocalOcrPort {
  constructor(private readonly worker: DrawingLocalRapidOcrWorkerClient = getDrawingLocalRapidOcrWorkerClient()) {}

  async runLocalOcr(input: DrawingLocalOcrRequest): Promise<PartMeasurementDrawingOcrToken[]> {
    return withTimeout(
      this.runLocalOcrInner(input),
      readRapidOcrTimeoutMs(),
      'rapidocr local OCR timed out'
    );
  }

  private async runLocalOcrInner(input: DrawingLocalOcrRequest): Promise<PartMeasurementDrawingOcrToken[]> {
    const metadata = await sharp(input.imageBytes, { failOn: 'none' }).metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;
    if (imageWidth <= 0 || imageHeight <= 0) {
      throw new Error('Invalid drawing image dimensions for rapidocr local OCR');
    }

    // RapidOCR is slower; use centered ROI (+ depth annulus) but only rotation 0
    // to keep secondary latency bounded. Primary tesseract already covers rotations.
    const rects = listLocalOcrRects({
      xRatio: input.xRatio,
      yRatio: input.yRatio,
      depthSearch: input.depthSearch,
      imageWidth,
      imageHeight
    });
    const rotations = DRAWING_LOCAL_OCR_ROTATIONS.slice(0, 1); // [0]

    const tokens: PartMeasurementDrawingOcrToken[] = [];
    let passIndex = 0;
    for (const rect of rects) {
      for (const rotation of rotations) {
        // eslint-disable-next-line no-await-in-loop
        const passImage = await renderLocalOcrPass(input.imageBytes, rect, rotation);
        // eslint-disable-next-line no-await-in-loop
        const words = await this.worker.recognize(passImage.buffer, readRapidOcrTimeoutMs());
        for (const word of words) {
          if (!/\d/.test(word.text)) continue;
          const ratios = mapBboxToOriginalRatios({
            bbox: word.bbox,
            ocrWidth: passImage.width,
            ocrHeight: passImage.height,
            rect,
            rotation,
            imageWidth,
            imageHeight
          });
          tokens.push({
            text: word.text,
            confidence: word.confidence,
            ...ratios,
            passId: `rapid-${passIndex}-r${rotation}`,
            passKind: 'tile',
            preprocessKind: 'raw',
            rotation
          });
        }
        passIndex += 1;
      }
    }
    return tokens;
  }
}
