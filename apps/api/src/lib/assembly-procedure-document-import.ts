import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { ApiError } from './errors.js';
import { convertPdfToImages } from './pdf-converter.js';
import { withPdfConvertSlot } from './pdf-convert-semaphore.js';
import {
  classifyDrawingUpload,
  getDrawingInputMaxBytes,
  getDrawingInputTooLargeMessage
} from './part-measurement-drawing-import-mime.js';
import { convertDrawingUploadToPreviewBuffer } from './part-measurement-drawing-preview.js';
import {
  PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES,
  PART_MEASUREMENT_PDF_JPEG_QUALITY,
  PART_MEASUREMENT_PDF_RENDER_DPI
} from './part-measurement-drawing-import.constants.js';
import { AssemblyProcedureImageStorage } from './assembly-procedure-image-storage.js';

export const ASSEMBLY_PROCEDURE_DOCUMENT_MAX_PAGES = 40;

export type AssemblyProcedureDocumentImportInput = {
  buffer: Buffer;
  mimetype: string;
  filename: string;
};

export type AssemblyProcedureDocumentImportResult = {
  relativeUrl: string;
  contentType: string;
};

export type AssemblyProcedureDocumentPageImportResult = {
  imageRelativePath: string;
  contentType: string;
};

export type AssemblyProcedureDocumentMultiPageImportResult = {
  pages: AssemblyProcedureDocumentPageImportResult[];
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

async function removeDirQuietly(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

async function savePreviewPage(preview: { buffer: Buffer; contentType: string }): Promise<AssemblyProcedureDocumentPageImportResult> {
  try {
    const saved = await AssemblyProcedureImageStorage.saveImage(preview.buffer, preview.contentType);
    return { imageRelativePath: saved.relativeUrl, contentType: saved.contentType };
  } catch (error) {
    wrapStorageError(error);
  }
}

async function convertPdfBufferToPageBuffers(buffer: Buffer): Promise<Buffer[]> {
  const tempDir = path.join(os.tmpdir(), `assembly-procedure-import-${randomUUID()}`);
  const pdfPath = path.join(tempDir, 'input.pdf');
  const outputDir = path.join(tempDir, 'pages');

  const run = async (): Promise<Buffer[]> => {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(pdfPath, buffer);
    await convertPdfToImages(pdfPath, outputDir, {
      prefix: 'page',
      format: 'jpeg',
      dpi: PART_MEASUREMENT_PDF_RENDER_DPI,
      quality: PART_MEASUREMENT_PDF_JPEG_QUALITY
    });

    const entries = await fs.readdir(outputDir);
    const pageFiles = entries
      .filter((name) => /\.jpe?g$/i.test(name))
      .sort((a, b) => {
        const pageA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
        const pageB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
        return pageA - pageB;
      });

    if (pageFiles.length === 0) {
      throw new ApiError(400, 'PDF の変換に失敗しました');
    }
    if (pageFiles.length > ASSEMBLY_PROCEDURE_DOCUMENT_MAX_PAGES) {
      throw new ApiError(400, `手順書は最大 ${ASSEMBLY_PROCEDURE_DOCUMENT_MAX_PAGES} ページまでです`);
    }

    const buffers: Buffer[] = [];
    for (const file of pageFiles) {
      const pageBuffer = await fs.readFile(path.join(outputDir, file));
      if (pageBuffer.length === 0) {
        throw new ApiError(400, 'PDF の変換に失敗しました');
      }
      if (pageBuffer.length > PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES) {
        throw new ApiError(400, '変換後の手順書画像が大きすぎます');
      }
      buffers.push(pageBuffer);
    }
    return buffers;
  };

  try {
    return await withPdfConvertSlot(run);
  } finally {
    await removeDirQuietly(tempDir);
  }
}

export async function importAssemblyProcedureDocumentPagesAndSave(
  input: AssemblyProcedureDocumentImportInput
): Promise<AssemblyProcedureDocumentMultiPageImportResult> {
  if (!input.buffer || input.buffer.length === 0) {
    throw new ApiError(400, '手順書ファイルが必要です');
  }

  const kind = classifyDrawingUpload(input.mimetype, input.filename);
  if (!kind) {
    throw new ApiError(400, '未対応の手順書形式です');
  }

  if (kind === 'pdf') {
    const pageBuffers = await convertPdfBufferToPageBuffers(input.buffer);
    const pages: AssemblyProcedureDocumentPageImportResult[] = [];
    for (const pageBuffer of pageBuffers) {
      pages.push(await savePreviewPage({ buffer: pageBuffer, contentType: 'image/jpeg' }));
    }
    return {
      pages,
      relativeUrl: pages[0]!.imageRelativePath,
      contentType: pages[0]!.contentType
    };
  }

  const preview = await convertDrawingUploadToPreviewBuffer(input);
  const page = await savePreviewPage(preview);
  return {
    pages: [page],
    relativeUrl: page.imageRelativePath,
    contentType: page.contentType
  };
}

/** @deprecated Use importAssemblyProcedureDocumentPagesAndSave */
export async function importAssemblyProcedureDocumentAndSave(
  input: AssemblyProcedureDocumentImportInput
): Promise<AssemblyProcedureDocumentImportResult> {
  const result = await importAssemblyProcedureDocumentPagesAndSave(input);
  return {
    relativeUrl: result.relativeUrl,
    contentType: result.contentType
  };
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
