import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { convertTiffBufferToJpeg } from '../convert-tiff-to-jpeg.js';

describe('convertTiffBufferToJpeg', () => {
  it('converts a minimal tiff buffer to jpeg', async () => {
    const tiff = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 10, g: 20, b: 30 }
      }
    })
      .tiff()
      .toBuffer();

    const jpeg = await convertTiffBufferToJpeg(tiff);
    expect(jpeg.length).toBeGreaterThan(0);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
  });

  it('rejects invalid magic', async () => {
    await expect(convertTiffBufferToJpeg(Buffer.from('%PDF-'))).rejects.toMatchObject({
      statusCode: 400,
      message: 'TIFF ファイルの形式が不正です'
    });
  });

  it('preserves oversized dimension error message', async () => {
    const tiff = await sharp({
      create: {
        width: 16_385,
        height: 1,
        channels: 3,
        background: { r: 10, g: 20, b: 30 }
      }
    })
      .tiff()
      .toBuffer();

    await expect(convertTiffBufferToJpeg(tiff)).rejects.toMatchObject({
      statusCode: 400,
      message: 'TIFF 画像の解像度が大きすぎます'
    });
  });
});
