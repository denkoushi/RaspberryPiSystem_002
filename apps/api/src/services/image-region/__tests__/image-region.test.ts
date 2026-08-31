import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { CoordinateOcrTextCandidateAdapter } from '../coordinate-ocr-text-candidate.adapter.js';
import {
  cropImageRegionRoi,
  imageRegionRoiToPixels
} from '../image-region-roi.js';
import { groupTextCandidates } from '../text-candidate-line-grouping.js';

describe('domain-neutral image-region services', () => {
  it('converts and crops a normalized ROI without a document-domain dependency', async () => {
    expect(
      imageRegionRoiToPixels(
        { xRatio: 0.25, yRatio: 0.125, widthRatio: 0.5, heightRatio: 0.5 },
        800,
        400
      )
    ).toEqual({ left: 200, top: 50, width: 400, height: 200 });

    const source = await sharp({
      create: {
        width: 100,
        height: 80,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
      .png()
      .toBuffer();
    const result = await cropImageRegionRoi(source, {
      xRatio: 0.1,
      yRatio: 0.25,
      widthRatio: 0.4,
      heightRatio: 0.5
    });
    expect(result.contentType).toBe('image/jpeg');
    expect(result.pixelRoi).toEqual({ left: 10, top: 20, width: 40, height: 40 });
    await expect(sharp(result.buffer).metadata()).resolves.toMatchObject({
      width: 40,
      height: 40
    });
  });

  it('maps coordinate OCR words and groups fragments through neutral ports', async () => {
    const image = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg()
      .toBuffer();
    const adapter = new CoordinateOcrTextCandidateAdapter({
      runLayoutOcrOnImage: vi.fn(async () => ({
        text: 'M8',
        engine: 'test',
        words: [
          { text: ' M8 ', confidence: 0.9, bbox: { x0: 20, y0: 10, x1: 80, y1: 30 } }
        ]
      }))
    });
    const [candidate] = await adapter.extractCandidates({ imageBytes: image });
    expect(candidate).toMatchObject({
      text: 'M8',
      bounds: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.2 },
      source: 'coordinate-ocr'
    });
    expect(
      groupTextCandidates([
        candidate,
        {
          ...candidate,
          text: '×20',
          bounds: {
            xRatio: 0.45,
            yRatio: 0.1,
            widthRatio: 0.2,
            heightRatio: 0.2
          }
        }
      ])[0].text
    ).toBe('M8×20');
  });
});
