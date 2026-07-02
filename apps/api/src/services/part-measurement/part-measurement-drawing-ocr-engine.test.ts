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

    expect(payload.ocrVersion).toBe('pm-drawing-ocr-v3');
    expect(layoutOcr.calls).toHaveLength(62);
    expect(new Set(payload.tokens.map((token) => token.rotation))).toEqual(new Set([0, 90, 180, 270]));
    expect(payload.tokens.some((token) => token.passKind === 'tile' && token.rotation === 90)).toBe(true);
    expect(payload.tokens.some((token) => token.passKind === 'tile' && token.rotation === 270)).toBe(true);
    expect(payload.tokens.some((token) => token.preprocessKind === 'lineSuppressed')).toBe(true);
  });

  it('adds boxed frame passes for detected geometric tolerance frames', async () => {
    const source = await sharp(
      Buffer.from(`
        <svg width="240" height="160" xmlns="http://www.w3.org/2000/svg">
          <rect width="240" height="160" fill="white"/>
          <rect x="64" y="70" width="112" height="28" fill="none" stroke="black" stroke-width="2"/>
          <line x1="112" y1="70" x2="112" y2="98" stroke="black" stroke-width="2"/>
          <text x="120" y="90" font-family="monospace" font-size="18" fill="black">0.050</text>
        </svg>
      `),
      { failOn: 'none' }
    )
      .png()
      .toBuffer();
    const layoutOcr = new RecordingLayoutOcr();
    const payload = await new PartMeasurementDrawingOcrEngine(layoutOcr).run(source);

    expect(layoutOcr.calls.length).toBeGreaterThan(62);
    expect(payload.tokens.some((token) => token.passKind === 'frame')).toBe(true);
    expect(payload.tokens.some((token) => token.preprocessKind === 'boxedFrame')).toBe(true);
  });
});
