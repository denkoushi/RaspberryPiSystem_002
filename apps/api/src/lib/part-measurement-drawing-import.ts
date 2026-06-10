import { ApiError } from './errors.js';
import {
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  getDrawingInputTooLargeMessage,
  resolveDrawingMime
} from './part-measurement-drawing-import-mime.js';
import { convertDrawingUploadToPreviewBuffer } from './part-measurement-drawing-preview.js';
import { PartMeasurementDrawingStorage } from './part-measurement-drawing-storage.js';

export type DrawingImportInput = {
  buffer: Buffer;
  mimetype: string;
  filename: string;
};

export type DrawingImportResult = {
  relativeUrl: string;
  contentType: string;
};

function wrapStorageError(error: unknown): never {
  if (error instanceof ApiError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('サポートしていない画像形式')) {
    throw new ApiError(400, '未対応の図面形式です');
  }
  if (message.includes('画像サイズが大きすぎます')) {
    throw new ApiError(400, '図面画像が大きすぎます');
  }
  throw error;
}

async function importPdfDrawing(buffer: Buffer): Promise<DrawingImportResult> {
  const { buffer: jpegBuffer } = await convertDrawingUploadToPreviewBuffer({
    buffer,
    mimetype: 'application/pdf',
    filename: 'drawing.pdf'
  });
  try {
    return await PartMeasurementDrawingStorage.saveDrawing(jpegBuffer, 'image/jpeg');
  } catch (error) {
    wrapStorageError(error);
  }
}

async function importTiffDrawing(buffer: Buffer): Promise<DrawingImportResult> {
  const { buffer: jpegBuffer } = await convertDrawingUploadToPreviewBuffer({
    buffer,
    mimetype: 'image/tiff',
    filename: 'drawing.tiff'
  });
  try {
    return await PartMeasurementDrawingStorage.saveDrawing(jpegBuffer, 'image/jpeg');
  } catch (error) {
    wrapStorageError(error);
  }
}

async function importImageDrawing(buffer: Buffer, mime: string): Promise<DrawingImportResult> {
  try {
    return await PartMeasurementDrawingStorage.saveDrawing(buffer, mime);
  } catch (error) {
    wrapStorageError(error);
  }
}

/**
 * 図面ファイル（画像、PDF、TIFF）を取り込み、保存済み storage URL を返す。
 * PDF/TIFF は JPEG 化してから保存する。
 */
export async function importDrawingAndSave(input: DrawingImportInput): Promise<DrawingImportResult> {
  const { buffer, mimetype, filename } = input;
  if (!buffer || buffer.length === 0) {
    throw new ApiError(400, '図面ファイルが必要です');
  }

  const kind = classifyDrawingUpload(mimetype, filename);
  if (!kind) {
    throw new ApiError(400, '未対応の図面形式です');
  }

  const maxBytes = getDrawingInputMaxBytes(kind);
  if (buffer.length > maxBytes) {
    throw new ApiError(400, getDrawingInputTooLargeMessage(kind));
  }

  const resolvedMime = resolveDrawingMime(mimetype, filename);
  if (!resolvedMime) {
    throw new ApiError(400, '未対応の図面形式です');
  }

  if (kind === 'pdf') {
    return importPdfDrawing(buffer);
  }

  if (kind === 'tiff') {
    return importTiffDrawing(buffer);
  }

  return importImageDrawing(buffer, resolvedMime);
}

/** multipart 読込前に MIME/拡張子から入力上限を決める */
export function resolveDrawingMultipartReadLimit(mimetype: string, filename: string): {
  maxBytes: number;
  tooLargeMessage: string;
} {
  const kind = classifyDrawingUpload(mimetype, filename);
  if (!kind) {
    return {
      maxBytes: PartMeasurementDrawingStorage.getMaxBytes(),
      tooLargeMessage: '図面画像が大きすぎます'
    };
  }
  return {
    maxBytes: getDrawingInputMaxBytes(kind),
    tooLargeMessage: getDrawingInputTooLargeMessage(kind)
  };
}
