import sharp from 'sharp';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { IMAGE_INPUT_MAX_PIXELS, validateImageBuffer } from '../validated-image.js';
import { DRAWING_MAX_PIXELS, PartMeasurementDrawingStorage } from '../part-measurement-drawing-storage.js';
import { AssemblyProcedureImageStorage } from '../assembly-procedure-image-storage.js';
import { MeasuringInstrumentGenreImageStorage } from '../measuring-instrument-genre-image-storage.js';
import { PalletMachineIllustrationStorage } from '../pallet-machine-illustration-storage.js';

const write = vi.hoisted(() => vi.fn());
vi.mock('../../services/file-storage/file-storage-runtime.js', () => ({ getFileStorageRuntime: () => ({ store: { write } }) }));
afterEach(() => vi.clearAllMocks());

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
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
    png.writeUInt32BE(100_001, 16);
    png.writeUInt32BE(1000, 20);
    // Keep the modified IHDR valid, so rejection demonstrates the pixel bound.
    let crc = 0xffffffff;
    for (const byte of png.subarray(12, 29)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    png.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
    await expect(sharp(png, { limitInputPixels: false }).metadata()).resolves.toMatchObject({
      format: 'png', width: 100_001, height: 1000,
    });
    await expect(validateImageBuffer(png, 'image/png')).rejects.toMatchObject({ statusCode: 400 });
  });
  it('accepts large drawings up to the drawing limit while other images keep the default limit', async () => {
    const jpeg = await sharp({ create: { width: 13248, height: 9355, channels: 3, background: 'white' } }).jpeg().toBuffer();
    await expect(validateImageBuffer(jpeg, 'image/jpeg')).rejects.toMatchObject({ statusCode: 400 });
    await expect(validateImageBuffer(jpeg, 'image/jpeg', DRAWING_MAX_PIXELS)).resolves.toBeUndefined();
    await expect(PartMeasurementDrawingStorage.saveDrawing(jpeg, 'image/jpeg')).resolves.toMatchObject({ contentType: 'image/jpeg' });
    await expect(AssemblyProcedureImageStorage.saveImage(jpeg, 'image/jpeg')).rejects.toMatchObject({ statusCode: 400 });
  }, 60_000);
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
