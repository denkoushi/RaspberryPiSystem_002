import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { convertPdfFirstPageToJpeg } from './convert-pdf-first-page-to-jpeg.js';
import { ApiError } from './errors.js';
import {
  assertPdfMagic,
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  getDrawingInputTooLargeMessage,
  resolveDrawingMime
} from './part-measurement-drawing-import-mime.js';
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

async function removeDirQuietly(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

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
  try {
    assertPdfMagic(buffer);
  } catch {
    throw new ApiError(400, 'PDF ファイルの形式が不正です');
  }

  const tempDir = path.join(os.tmpdir(), `pm-drawing-import-${randomUUID()}`);
  const pdfPath = path.join(tempDir, 'input.pdf');
  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(pdfPath, buffer);
    const jpegBuffer = await convertPdfFirstPageToJpeg(pdfPath, tempDir);
    try {
      return await PartMeasurementDrawingStorage.saveDrawing(jpegBuffer, 'image/jpeg');
    } catch (error) {
      wrapStorageError(error);
    }
  } finally {
    await removeDirQuietly(tempDir);
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
 * 図面ファイル（画像または PDF）を取り込み、保存済み storage URL を返す。
 * PDF は 1 ページ目のみ JPEG 化してから保存する。
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
