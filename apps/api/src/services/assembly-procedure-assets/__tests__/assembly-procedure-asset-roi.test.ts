import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  assemblyProcedureAssetRoiToPixels,
  cropAssemblyProcedureAssetRoi,
  normalizeAssemblyProcedureAssetRoi,
} from '../assembly-procedure-asset-roi.js';

describe('assembly procedure asset ROI', () => {
  it('projects normalized coordinates to bounded pixels', () => {
    expect(
      assemblyProcedureAssetRoiToPixels(
        { xRatio: 0.25, yRatio: 0.125, widthRatio: 0.5, heightRatio: 0.5 },
        800,
        400,
      ),
    ).toEqual({ left: 200, top: 50, width: 400, height: 200 });
  });

  it('cuts a JPEG ROI with Sharp', async () => {
    const source = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const result = await cropAssemblyProcedureAssetRoi(source, {
      xRatio: 0.1,
      yRatio: 0.25,
      widthRatio: 0.4,
      heightRatio: 0.5,
    });
    expect(result.contentType).toBe('image/jpeg');
    expect(result.pixelRoi).toEqual({ left: 10, top: 20, width: 40, height: 40 });
    await expect(sharp(result.buffer).metadata()).resolves.toMatchObject({ width: 40, height: 40 });
  });

  it('rejects a ROI outside the source page', () => {
    expect(() =>
      normalizeAssemblyProcedureAssetRoi({
        xRatio: 0.8,
        yRatio: 0,
        widthRatio: 0.3,
        heightRatio: 0.2,
      }),
    ).toThrow('outside');
  });
});
