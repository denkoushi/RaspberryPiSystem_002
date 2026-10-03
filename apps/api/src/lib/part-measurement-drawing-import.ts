import { ApiError } from './errors.js';
import {
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  getDrawingInputTooLargeMessage,
  resolveDrawingMime
} from './part-measurement-drawing-import-mime.js';
import { convertDrawingUploadToPreviewBuffer } from './part-measurement-drawing-preview.js';
import { PartMeasurementDrawingStorage, type DrawingSourceKind } from './part-measurement-drawing-storage.js';

export type DrawingImportInput = {
  buffer: Buffer;
  mimetype: string;
  filename: string;
};

export type DrawingImportResult = {
  relativeUrl: string;
  contentType: string;
  /** PDF/TIFF 取込時の原本キー。画像を直接取り込んだ場合は保存画像が原本なので null */
  sourceStorageKey: string | null;
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

async function importConvertedDrawing(
  buffer: Buffer,
  kind: DrawingSourceKind,
  mimetype: string,
  filename: string
): Promise<DrawingImportResult> {
  const { buffer: jpegBuffer } = await convertDrawingUploadToPreviewBuffer({ buffer, mimetype, filename });
  let saved: { relativeUrl: string; contentType: string };
  try {
    saved = await PartMeasurementDrawingStorage.saveDrawing(jpegBuffer, 'image/jpeg');
  } catch (error) {
    wrapStorageError(error);
  }
  try {
    const { storageKey } = await PartMeasurementDrawingStorage.saveDrawingSource(buffer, kind);
    return { ...saved, sourceStorageKey: storageKey };
  } catch (error) {
    await PartMeasurementDrawingStorage.deleteDrawing(saved.relativeUrl).catch(() => undefined);
    throw error;
  }
}

async function importImageDrawing(buffer: Buffer, mime: string): Promise<DrawingImportResult> {
  try {
    const saved = await PartMeasurementDrawingStorage.saveDrawing(buffer, mime);
    return { ...saved, sourceStorageKey: null };
  } catch (error) {
    wrapStorageError(error);
  }
}

/**
 * 図面ファイル（画像、PDF、TIFF）を取り込み、保存済み storage URL を返す。
 * PDF/TIFF は表示用に JPEG 化して保存し、原本も別キーで保持する。
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
    return importConvertedDrawing(buffer, 'pdf', 'application/pdf', 'drawing.pdf');
  }

  if (kind === 'tiff') {
    return importConvertedDrawing(buffer, 'tiff', 'image/tiff', 'drawing.tiff');
  }

  return importImageDrawing(buffer, resolvedMime);
}

/** 図面と原本をまとめて回収する（未参照時のみ呼ぶ） */
export async function deleteImportedDrawing(result: Pick<DrawingImportResult, 'relativeUrl' | 'sourceStorageKey'>): Promise<void> {
  await PartMeasurementDrawingStorage.deleteDrawing(result.relativeUrl).catch(() => undefined);
  if (result.sourceStorageKey) {
    await PartMeasurementDrawingStorage.deleteDrawingSource(result.sourceStorageKey);
  }
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
