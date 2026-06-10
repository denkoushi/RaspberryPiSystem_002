import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../errors.js';
import { convertDrawingUploadToPreviewBuffer } from '../part-measurement-drawing-preview.js';

vi.mock('../convert-pdf-first-page-to-jpeg.js', () => ({
  convertPdfFirstPageToJpeg: vi.fn()
}));

vi.mock('../convert-tiff-to-jpeg.js', () => ({
  convertTiffBufferToJpeg: vi.fn()
}));

import { convertPdfFirstPageToJpeg } from '../convert-pdf-first-page-to-jpeg.js';
import { convertTiffBufferToJpeg } from '../convert-tiff-to-jpeg.js';
import { buildMinimalValidPdfBuffer } from './fixtures/minimal-pdf.js';
import { PartMeasurementDrawingStorage } from '../part-measurement-drawing-storage.js';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MIN_PDF = buildMinimalValidPdfBuffer();

describe('convertDrawingUploadToPreviewBuffer', () => {
  beforeEach(() => {
    vi.mocked(convertPdfFirstPageToJpeg).mockReset();
    vi.mocked(convertTiffBufferToJpeg).mockReset();
  });

  it('returns png buffer without storage write', async () => {
    const saveSpy = vi.spyOn(PartMeasurementDrawingStorage, 'saveDrawing');

    const result = await convertDrawingUploadToPreviewBuffer({
      buffer: MIN_PNG,
      mimetype: 'image/png',
      filename: 't.png'
    });

    expect(result.contentType).toBe('image/png');
    expect(result.buffer).toBe(MIN_PNG);
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('converts pdf to jpeg without storage write', async () => {
    const jpeg = Buffer.from('jpeg-bytes');
    vi.mocked(convertPdfFirstPageToJpeg).mockResolvedValue(jpeg);
    const saveSpy = vi.spyOn(PartMeasurementDrawingStorage, 'saveDrawing');

    const result = await convertDrawingUploadToPreviewBuffer({
      buffer: MIN_PDF,
      mimetype: 'application/pdf',
      filename: 'drawing.pdf'
    });

    expect(convertPdfFirstPageToJpeg).toHaveBeenCalled();
    expect(result.contentType).toBe('image/jpeg');
    expect(result.buffer).toBe(jpeg);
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('converts tiff to jpeg without storage write', async () => {
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]);
    const jpeg = Buffer.from('jpeg-from-tiff');
    vi.mocked(convertTiffBufferToJpeg).mockResolvedValue(jpeg);
    const saveSpy = vi.spyOn(PartMeasurementDrawingStorage, 'saveDrawing');

    const result = await convertDrawingUploadToPreviewBuffer({
      buffer: tiff,
      mimetype: 'image/tiff',
      filename: 'drawing.tiff'
    });

    expect(convertTiffBufferToJpeg).toHaveBeenCalledWith(tiff);
    expect(result.contentType).toBe('image/jpeg');
    expect(result.buffer).toBe(jpeg);
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('rejects fake pdf extension without magic', async () => {
    await expect(
      convertDrawingUploadToPreviewBuffer({
        buffer: MIN_PNG,
        mimetype: 'application/pdf',
        filename: 'fake.pdf'
      })
    ).rejects.toMatchObject({ statusCode: 400, message: 'PDF ファイルの形式が不正です' });
  });

  it('rejects unsupported format as ApiError 400', async () => {
    await expect(
      convertDrawingUploadToPreviewBuffer({
        buffer: Buffer.from('hello'),
        mimetype: 'text/plain',
        filename: 'a.txt'
      })
    ).rejects.toBeInstanceOf(ApiError);
  });
});
