import sharp from 'sharp';

import { ApiError } from './errors.js';
import { AssemblyProcedureImageStorage } from './assembly-procedure-image-storage.js';
import { PART_MEASUREMENT_PDF_INPUT_MAX_BYTES } from './part-measurement-drawing-import.constants.js';

export const ASSEMBLY_PROCEDURE_JPEG_INPUT_MAX_BYTES = PART_MEASUREMENT_PDF_INPUT_MAX_BYTES;
export const ASSEMBLY_PROCEDURE_JPEG_MAX_LONG_EDGE = 3000;
export const ASSEMBLY_PROCEDURE_JPEG_LIMIT_INPUT_PIXELS = 150_000_000;
export const ASSEMBLY_PROCEDURE_JPEG_INITIAL_QUALITY = 85;

const JPEG_QUALITY_STEPS = [85, 80, 75, 70, 65, 60, 55];

function hasJpegMagic(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export async function normalizeAssemblyProcedureJpeg(buffer: Buffer): Promise<Buffer> {
  if (!buffer.length) {
    throw new ApiError(400, 'JPEG ファイルが空です', undefined, 'ASSEMBLY_PROCEDURE_JPEG_EMPTY');
  }
  if (buffer.length > ASSEMBLY_PROCEDURE_JPEG_INPUT_MAX_BYTES) {
    throw new ApiError(
      400,
      'JPEG ファイルが大きすぎます（最大 30 MiB）',
      undefined,
      'ASSEMBLY_PROCEDURE_JPEG_TOO_LARGE'
    );
  }
  if (!hasJpegMagic(buffer)) {
    throw new ApiError(400, 'JPEG ファイルの形式が不正です', undefined, 'ASSEMBLY_PROCEDURE_JPEG_INVALID');
  }

  try {
    const metadata = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: ASSEMBLY_PROCEDURE_JPEG_LIMIT_INPUT_PIXELS,
      sequentialRead: true
    }).metadata();
    if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height) {
      throw new Error('JPEG_METADATA_INVALID');
    }

    for (const quality of JPEG_QUALITY_STEPS) {
      const normalized = await sharp(buffer, {
        failOn: 'error',
        limitInputPixels: ASSEMBLY_PROCEDURE_JPEG_LIMIT_INPUT_PIXELS,
        sequentialRead: true
      })
        .rotate()
        .resize(ASSEMBLY_PROCEDURE_JPEG_MAX_LONG_EDGE, ASSEMBLY_PROCEDURE_JPEG_MAX_LONG_EDGE, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (normalized.length <= AssemblyProcedureImageStorage.getMaxBytes()) {
        return normalized;
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      'JPEG ファイルを読み込めませんでした',
      { detail: error instanceof Error ? error.message : String(error) },
      'ASSEMBLY_PROCEDURE_JPEG_INVALID'
    );
  }

  throw new ApiError(
    400,
    'JPEG ファイルを保存可能なサイズへ縮小できませんでした',
    undefined,
    'ASSEMBLY_PROCEDURE_JPEG_NORMALIZE_FAILED'
  );
}
