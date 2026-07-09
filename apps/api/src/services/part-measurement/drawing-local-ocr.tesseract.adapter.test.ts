import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { ImageOcrInput, ImageOcrLayoutPort, ImageOcrLayoutResult } from '../ocr/index.js';
import { DrawingLocalOcrTesseractAdapter } from './drawing-local-ocr.tesseract.adapter.js';

class StubLayoutOcr implements ImageOcrLayoutPort {
  calls: ImageOcrInput[] = [];

  constructor(private readonly result: ImageOcrLayoutResult) {}

  async runLayoutOcrOnImage(input: ImageOcrInput): Promise<ImageOcrLayoutResult> {
    this.calls.push(input);
    return this.result;
  }
}

describe('DrawingLocalOcrTesseractAdapter', () => {
  it('crops around the marker and maps OCR words to image ratios', async () => {
    const imageBytes = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg()
      .toBuffer();

    const stub = new StubLayoutOcr({
      text: '25',
      engine: 'stub',
      words: [
        {
          text: '25',
          confidence: 91,
          bbox: { x0: 10, y0: 10, x1: 40, y1: 30 }
        }
      ]
    });
    const adapter = new DrawingLocalOcrTesseractAdapter(stub);
    const tokens = await adapter.runLocalOcr({
      imageBytes,
      xRatio: 0.5,
      yRatio: 0.5,
      depthSearch: false
    });

    expect(stub.calls.length).toBeGreaterThan(0);
    expect(stub.calls[0]?.profile).toBe('partMeasurementDrawingDimensions');
    expect(tokens.some((token) => token.text === '25')).toBe(true);
    const hit = tokens.find((token) => token.text === '25');
    expect(hit?.xRatio).toBeGreaterThan(0.3);
    expect(hit?.xRatio).toBeLessThan(0.7);
    expect(hit?.passKind).toBe('tile');
  });

  it('runs additional ROI passes when depthSearch is enabled', async () => {
    const imageBytes = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .png()
      .toBuffer();

    const stub = new StubLayoutOcr({
      text: '深サ8',
      engine: 'stub',
      words: [{ text: '深サ8', confidence: 70, bbox: { x0: 5, y0: 5, x1: 50, y1: 25 } }]
    });
    const adapter = new DrawingLocalOcrTesseractAdapter(stub);
    const spy = vi.spyOn(stub, 'runLayoutOcrOnImage');
    await adapter.runLocalOcr({
      imageBytes,
      xRatio: 0.4,
      yRatio: 0.4,
      depthSearch: true
    });
    // centered ROI * 3 rotations + up to 2 annulus * 3 rotations
    expect(spy.mock.calls.length).toBeGreaterThan(3);
  });
});
