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
    expect(saveSpy).toHaveBeenCalledWith(MIN_PNG, 'image/png');
    saveSpy.mockRestore();
  });

  it('converts pdf first page then saves jpeg', async () => {
    const jpeg = Buffer.from('jpeg-bytes');
    vi.mocked(convertPdfFirstPageToJpeg).mockResolvedValue(jpeg);
    const saveSpy = vi
      .spyOn(PartMeasurementDrawingStorage, 'saveDrawing')
      .mockResolvedValue({
        relativeUrl: '/api/storage/part-measurement-drawings/uuid.jpg',
        contentType: 'image/jpeg'
      });

    const result = await importDrawingAndSave({
      buffer: MIN_PDF,
      mimetype: 'application/pdf',
      filename: 'drawing.pdf'
    });

    expect(convertPdfFirstPageToJpeg).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledWith(jpeg, 'image/jpeg');
    expect(result.relativeUrl).toMatch(/\.jpg$/);
    saveSpy.mockRestore();
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
