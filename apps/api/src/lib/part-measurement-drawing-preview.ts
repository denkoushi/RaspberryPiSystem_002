import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { convertPdfFirstPageToJpeg } from './convert-pdf-first-page-to-jpeg.js';
import { convertTiffBufferToJpeg } from './convert-tiff-to-jpeg.js';
import { ApiError } from './errors.js';
import {
  assertPdfMagic,
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  getDrawingInputTooLargeMessage,
  resolveDrawingMime
} from './part-measurement-drawing-import-mime.js';
import { PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES } from './part-measurement-drawing-import.constants.js';

type DrawingPreviewInput = {
  buffer: Buffer;
  mimetype: string;
  filename: string;
};

export type DrawingPreviewResult = {
  buffer: Buffer;
  contentType: string;
};

async function removeDirQuietly(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

async function convertPdfToPreviewBuffer(buffer: Buffer): Promise<Buffer> {
  try {
    assertPdfMagic(buffer);
  } catch {
    throw new ApiError(400, 'PDF ファイルの形式が不正です');
  }

  const tempDir = path.join(os.tmpdir(), `pm-drawing-preview-${randomUUID()}`);
  const pdfPath = path.join(tempDir, 'input.pdf');
  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(pdfPath, buffer);
    const jpegBuffer = await convertPdfFirstPageToJpeg(pdfPath, tempDir);
    if (jpegBuffer.length > PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES) {
      throw new ApiError(400, '変換後の図面画像が大きすぎます');
    }
    if (jpegBuffer.length === 0) {
      throw new ApiError(400, 'PDF の変換に失敗しました');
    }
    return jpegBuffer;
  } finally {
    await removeDirQuietly(tempDir);
  }
}

async function convertTiffToPreviewBuffer(buffer: Buffer): Promise<Buffer> {
  return convertTiffBufferToJpeg(buffer);
}

/**
 * 図面ファイルをプレビュー用バイナリへ変換する（storage / DB 書き込みなし）。
 * PDF/TIFF は JPEG 化。画像はそのまま返す。
 */
export async function convertDrawingUploadToPreviewBuffer(
  input: DrawingPreviewInput
): Promise<DrawingPreviewResult> {
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
    const jpegBuffer = await convertPdfToPreviewBuffer(buffer);
    return { buffer: jpegBuffer, contentType: 'image/jpeg' };
  }

  if (kind === 'tiff') {
    const jpegBuffer = await convertTiffToPreviewBuffer(buffer);
    return { buffer: jpegBuffer, contentType: 'image/jpeg' };
  }

  return { buffer, contentType: resolvedMime };
}
