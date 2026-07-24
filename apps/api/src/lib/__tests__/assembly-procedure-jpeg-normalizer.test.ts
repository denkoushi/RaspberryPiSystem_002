import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  ASSEMBLY_PROCEDURE_JPEG_INPUT_MAX_BYTES,
  ASSEMBLY_PROCEDURE_JPEG_MAX_LONG_EDGE,
  normalizeAssemblyProcedureJpeg
} from '../assembly-procedure-jpeg-normalizer.js';
import { AssemblyProcedureImageStorage } from '../assembly-procedure-image-storage.js';

describe('normalizeAssemblyProcedureJpeg', () => {
  it('resizes a large JPEG to the configured long edge and storage limit', async () => {
    const input = await sharp({
      create: {
        width: 5000,
        height: 1200,
        channels: 3,
        background: { r: 245, g: 245, b: 245 }
      }
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const output = await normalizeAssemblyProcedureJpeg(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(
      ASSEMBLY_PROCEDURE_JPEG_MAX_LONG_EDGE
    );
    expect(output.length).toBeLessThanOrEqual(AssemblyProcedureImageStorage.getMaxBytes());
  });

  it('applies EXIF orientation before saving', async () => {
    const input = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 3,
        background: { r: 30, g: 60, b: 90 }
      }
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const output = await normalizeAssemblyProcedureJpeg(input);
    const metadata = await sharp(output).metadata();
    expect(metadata.width).toBe(40);
    expect(metadata.height).toBe(80);
    expect(metadata.orientation).toBeUndefined();
  });

  it('rejects corrupt JPEG content', async () => {
    await expect(
      normalizeAssemblyProcedureJpeg(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]))
    ).rejects.toMatchObject({ code: 'ASSEMBLY_PROCEDURE_JPEG_INVALID' });
  });

  it('rejects input larger than 30 MiB before decoding', async () => {
    const input = Buffer.alloc(ASSEMBLY_PROCEDURE_JPEG_INPUT_MAX_BYTES + 1);
    input[0] = 0xff;
    input[1] = 0xd8;
    input[2] = 0xff;
    await expect(normalizeAssemblyProcedureJpeg(input)).rejects.toMatchObject({
      code: 'ASSEMBLY_PROCEDURE_JPEG_TOO_LARGE'
    });
  });
});
