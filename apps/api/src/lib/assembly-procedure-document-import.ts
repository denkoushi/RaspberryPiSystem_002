import { ApiError } from './errors.js';
import {
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  getDrawingInputTooLargeMessage
} from './part-measurement-drawing-import-mime.js';
import { convertDrawingUploadToPreviewBuffer } from './part-measurement-drawing-preview.js';
import { AssemblyProcedureImageStorage } from './assembly-procedure-image-storage.js';

export type AssemblyProcedureDocumentImportInput = {
  buffer: Buffer;
  mimetype: string;
  filename: string;
};

export type AssemblyProcedureDocumentImportResult = {
  relativeUrl: string;
  contentType: string;
};

function wrapStorageError(error: unknown): never {
  if (error instanceof ApiError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('サポートしていない')) {
    throw new ApiError(400, '未対応の手順書形式です');
  }
  if (message.includes('大きすぎます')) {
    throw new ApiError(400, '手順書画像が大きすぎます');
  }
  throw error;
}

export async function importAssemblyProcedureDocumentAndSave(
  input: AssemblyProcedureDocumentImportInput
): Promise<AssemblyProcedureDocumentImportResult> {
  if (!input.buffer || input.buffer.length === 0) {
    throw new ApiError(400, '手順書ファイルが必要です');
  }

  const preview = await convertDrawingUploadToPreviewBuffer(input);
  try {
    return await AssemblyProcedureImageStorage.saveImage(preview.buffer, preview.contentType);
  } catch (error) {
    wrapStorageError(error);
  }
}

export function resolveAssemblyProcedureMultipartReadLimit(mimetype: string, filename: string): {
  maxBytes: number;
  tooLargeMessage: string;
} {
  const kind = classifyDrawingUpload(mimetype, filename);
  if (!kind) {
    return {
      maxBytes: AssemblyProcedureImageStorage.getMaxBytes(),
      tooLargeMessage: '手順書画像が大きすぎます'
    };
  }
  return {
    maxBytes: getDrawingInputMaxBytes(kind),
    tooLargeMessage: getDrawingInputTooLargeMessage(kind).replace('図面', '手順書')
  };
}
