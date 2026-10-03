import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../errors.js';
import { importDrawingAndSave } from '../part-measurement-drawing-import.js';
import { PartMeasurementDrawingStorage } from '../part-measurement-drawing-storage.js';

vi.mock('../convert-pdf-first-page-to-jpeg.js', () => ({
  convertPdfFirstPageToJpeg: vi.fn()
}));

import { convertPdfFirstPageToJpeg } from '../convert-pdf-first-page-to-jpeg.js';
import { buildMinimalValidPdfBuffer } from './fixtures/minimal-pdf.js';

const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MIN_PDF = buildMinimalValidPdfBuffer();

describe('importDrawingAndSave', () => {
  beforeEach(() => {
    vi.mocked(convertPdfFirstPageToJpeg).mockReset();
  });

  it('saves png and returns jpg/png url', async () => {
    const saveSpy = vi
      .spyOn(PartMeasurementDrawingStorage, 'saveDrawing')
      .mockResolvedValue({
        relativeUrl: '/api/storage/part-measurement-drawings/uuid.png',
        contentType: 'image/png'
      });

    const result = await importDrawingAndSave({
      buffer: MIN_PNG,
      mimetype: 'image/png',
      filename: 't.png'
    });

    expect(result.relativeUrl).toMatch(/\.png$/);
    expect(result.sourceStorageKey).toBeNull();
    expect(saveSpy).toHaveBeenCalledWith(MIN_PNG, 'image/png');
    saveSpy.mockRestore();
  });

  it('converts pdf first page then saves jpeg and keeps the pdf source', async () => {
    const jpeg = Buffer.from('jpeg-bytes');
    vi.mocked(convertPdfFirstPageToJpeg).mockResolvedValue(jpeg);
    const saveSpy = vi
      .spyOn(PartMeasurementDrawingStorage, 'saveDrawing')
      .mockResolvedValue({
        relativeUrl: '/api/storage/part-measurement-drawings/uuid.jpg',
        contentType: 'image/jpeg'
      });
    const sourceKey = 'part-measurement-drawings/sources/00000000-0000-4000-8000-000000000000.pdf';
    const saveSourceSpy = vi
      .spyOn(PartMeasurementDrawingStorage, 'saveDrawingSource')
      .mockResolvedValue({ storageKey: sourceKey });

    const result = await importDrawingAndSave({
      buffer: MIN_PDF,
      mimetype: 'application/pdf',
      filename: 'drawing.pdf'
    });

    expect(convertPdfFirstPageToJpeg).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledWith(jpeg, 'image/jpeg');
    expect(saveSourceSpy).toHaveBeenCalledWith(MIN_PDF, 'pdf');
    expect(result.relativeUrl).toMatch(/\.jpg$/);
    expect(result.sourceStorageKey).toBe(sourceKey);
    saveSpy.mockRestore();
    saveSourceSpy.mockRestore();
  });

  it('removes the saved drawing when the source cannot be kept', async () => {
    vi.mocked(convertPdfFirstPageToJpeg).mockResolvedValue(Buffer.from('jpeg-bytes'));
    const saveSpy = vi.spyOn(PartMeasurementDrawingStorage, 'saveDrawing').mockResolvedValue({
      relativeUrl: '/api/storage/part-measurement-drawings/uuid.jpg',
      contentType: 'image/jpeg'
    });
    const saveSourceSpy = vi
      .spyOn(PartMeasurementDrawingStorage, 'saveDrawingSource')
      .mockRejectedValue(new Error('disk full'));
    const deleteSpy = vi.spyOn(PartMeasurementDrawingStorage, 'deleteDrawing').mockResolvedValue();

    await expect(
      importDrawingAndSave({ buffer: MIN_PDF, mimetype: 'application/pdf', filename: 'drawing.pdf' })
    ).rejects.toThrow('disk full');
    expect(deleteSpy).toHaveBeenCalledWith('/api/storage/part-measurement-drawings/uuid.jpg');
    saveSpy.mockRestore();
    saveSourceSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it('rejects fake pdf extension without magic', async () => {
    await expect(
      importDrawingAndSave({
        buffer: MIN_PNG,
        mimetype: 'application/pdf',
        filename: 'fake.pdf'
      })
    ).rejects.toMatchObject({ statusCode: 400, message: 'PDF ファイルの形式が不正です' });
  });

  it('rejects unsupported format as ApiError 400', async () => {
    await expect(
      importDrawingAndSave({
        buffer: Buffer.from('hello'),
        mimetype: 'text/plain',
        filename: 'a.txt'
      })
    ).rejects.toBeInstanceOf(ApiError);
  });
});
