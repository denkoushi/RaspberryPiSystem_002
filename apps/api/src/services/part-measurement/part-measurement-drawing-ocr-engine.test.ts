import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { ImageOcrInput, ImageOcrLayoutPort, ImageOcrLayoutResult } from '../ocr/index.js';
import { PartMeasurementDrawingOcrEngine } from './part-measurement-drawing-ocr-engine.js';

class RecordingLayoutOcr implements ImageOcrLayoutPort {
  calls: Array<{ width: number; height: number }> = [];

  async runLayoutOcrOnImage(input: ImageOcrInput): Promise<ImageOcrLayoutResult> {
    const metadata = await sharp(input.imageBytes, { failOn: 'none' }).metadata();
    this.calls.push({ width: metadata.width ?? 0, height: metadata.height ?? 0 });
    return {
      text: '1',
      engine: 'test-layout-ocr',
      words: [
        {
          text: '1',
          confidence: 90,
          bbox: { x0: 1, y0: 1, x1: 8, y1: 8 }
        }
      ]
    };
  }
}

describe('PartMeasurementDrawingOcrEngine', () => {
  it('renders 90/270 degree full and tile passes without invalid crop errors', async () => {
    const source = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: 'white'
      }
    })
      .jpeg()
      .toBuffer();
    const layoutOcr = new RecordingLayoutOcr();
    const payload = await new PartMeasurementDrawingOcrEngine(layoutOcr).run(source);

    expect(payload.ocrVersion).toBe('pm-drawing-ocr-v2');
    expect(layoutOcr.calls).toHaveLength(31);
    expect(new Set(payload.tokens.map((token) => token.rotation))).toEqual(new Set([0, 90, 180, 270]));
    expect(payload.tokens.some((token) => token.passKind === 'tile' && token.rotation === 90)).toBe(true);
    expect(payload.tokens.some((token) => token.passKind === 'tile' && token.rotation === 270)).toBe(true);
  });
});
