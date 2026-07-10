import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { DrawingLocalOcrRapidOcrAdapter } from './drawing-local-ocr.rapidocr.adapter.js';
import type { DrawingLocalRapidOcrWorkerClient } from './drawing-local-rapidocr-worker.client.js';

describe('DrawingLocalOcrRapidOcrAdapter', () => {
  it('maps worker words onto original image ratios with rapid passId', async () => {
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

    const worker: DrawingLocalRapidOcrWorkerClient = {
      recognize: vi.fn(async () => [
        {
          text: '13.6',
          confidence: 88,
          bbox: { x0: 8, y0: 8, x1: 40, y1: 28 }
        }
      ]),
      dispose: vi.fn(async () => undefined)
    };

    const adapter = new DrawingLocalOcrRapidOcrAdapter(worker);
    const tokens = await adapter.runLocalOcr({
      imageBytes,
      xRatio: 0.5,
      yRatio: 0.5,
      depthSearch: false
    });

    expect(worker.recognize).toHaveBeenCalled();
    expect(tokens.some((token) => token.text === '13.6')).toBe(true);
    const hit = tokens.find((token) => token.text === '13.6');
    expect(hit?.passId.startsWith('rapid-')).toBe(true);
    expect(hit?.xRatio).toBeGreaterThan(0.3);
    expect(hit?.xRatio).toBeLessThan(0.7);
  });
});
