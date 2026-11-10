import sharp from 'sharp';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { IMAGE_INPUT_MAX_PIXELS, validateImageBuffer } from '../validated-image.js';
import { DRAWING_UPLOAD_MAX_PIXELS, PartMeasurementDrawingStorage } from '../part-measurement-drawing-storage.js';
import { convertDrawingUploadToPreviewBuffer } from '../part-measurement-drawing-preview.js';
import { AssemblyProcedureImageStorage } from '../assembly-procedure-image-storage.js';
import { MeasuringInstrumentGenreImageStorage } from '../measuring-instrument-genre-image-storage.js';
import { PalletMachineIllustrationStorage } from '../pallet-machine-illustration-storage.js';

const write = vi.hoisted(() => vi.fn());
vi.mock('../../services/file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: { write } }) }));
afterEach(() => vi.clearAllMocks());

/** 1×1 の PNG の IHDR だけを書き換え、画素データを持たない大きな画像の見出しを作る。 */
async function pngHeader(width: number, height: number): Promise<Buffer> {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  // Keep the modified IHDR valid, so rejection demonstrates the pixel bound.
  let crc = 0xffffffff;
  for (const byte of png.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  png.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  return png;
}

describe('validated image uploads', () => {
  it.each(['png', 'jpeg', 'webp', 'tiff'] as const)('accepts actual %s image data', async format => {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
    await expect(validateImageBuffer(buffer, `image/${format}`)).resolves.toBeUndefined();
  });
  it.each([
    ['unreadable bytes', Buffer.from('not an image')],
    ['SVG disguised as PNG', Buffer.from('<svg width="2" height="2" xmlns="http://www.w3.org/2000/svg"/>')],
    ['excessive dimensions', Buffer.from(`P6\n${IMAGE_INPUT_MAX_PIXELS + 1} 1\n255\n`)],
  ])('rejects %s with a client error', async (_, buffer) => {
    await expect(validateImageBuffer(buffer, 'image/png')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('rejects oversized PNG headers before decoding pixel data', async () => {
    const png = await pngHeader(100_001, 1000);
    await expect(sharp(png, { limitInputPixels: false }).metadata()).resolves.toMatchObject({
      format: 'png', width: 100_001, height: 1000,
    });
    await expect(validateImageBuffer(png, 'image/png')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('accepts large drawings up to the drawing upload limit while other images keep the default limit', async () => {
    const large = await pngHeader(13248, 9355);
    await expect(validateImageBuffer(large, 'image/png')).rejects.toMatchObject({ statusCode: 400 });
    await expect(validateImageBuffer(large, 'image/png', DRAWING_UPLOAD_MAX_PIXELS)).resolves.toBeUndefined();
    await expect(PartMeasurementDrawingStorage.saveDrawing(large, 'image/png')).resolves.toMatchObject({ contentType: 'image/png' });
    await expect(AssemblyProcedureImageStorage.saveImage(large, 'image/png')).rejects.toMatchObject({ statusCode: 400 });
    await expect(convertDrawingUploadToPreviewBuffer({ buffer: large, mimetype: 'image/png', filename: 'large.png' })).resolves.toMatchObject({ contentType: 'image/png' });
    const tooLarge = await pngHeader(15000, 10001);
    await expect(PartMeasurementDrawingStorage.saveDrawing(tooLarge, 'image/png')).rejects.toMatchObject({ statusCode: 400 });
  });
  it.each([
    PartMeasurementDrawingStorage.saveDrawing.bind(PartMeasurementDrawingStorage),
    AssemblyProcedureImageStorage.saveImage.bind(AssemblyProcedureImageStorage),
    MeasuringInstrumentGenreImageStorage.save.bind(MeasuringInstrumentGenreImageStorage),
    PalletMachineIllustrationStorage.saveIllustration.bind(PalletMachineIllustrationStorage),
  ])('validates before storage and preserves valid PNG writes', async save => {
    await expect(save(Buffer.from('invalid'), 'image/png')).rejects.toMatchObject({ statusCode: 400 });
    expect(write).not.toHaveBeenCalled();
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(save(buffer, 'image/png')).resolves.toMatchObject({ contentType: 'image/png' });
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ data: buffer, mode: 'create' }));
  });
});
