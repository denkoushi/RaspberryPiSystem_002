import { Worker } from 'worker_threads';

import { ApiError } from './errors.js';
import { logger } from './logger.js';
import {
  PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES,
  PART_MEASUREMENT_TIFF_CONVERT_TIMEOUT_MS,
  PART_MEASUREMENT_TIFF_JPEG_QUALITY,
  PART_MEASUREMENT_TIFF_LIMIT_INPUT_PIXELS,
  PART_MEASUREMENT_TIFF_MAX_HEIGHT,
  PART_MEASUREMENT_TIFF_MAX_WIDTH
} from './part-measurement-drawing-import.constants.js';
import { withDrawingRasterConvertSlot } from './drawing-raster-convert-semaphore.js';
import { assertTiffMagic } from './part-measurement-drawing-import-mime.js';

function mapSharpTiffFailure(err: unknown): ApiError {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes('input image exceeds pixel limit')) {
    return new ApiError(400, 'TIFF 画像の解像度が大きすぎます');
  }
  logger.warn({ err }, 'sharp TIFF conversion failed');
  return new ApiError(400, 'TIFF の変換に失敗しました');
}

type TiffWorkerMessage =
  | { ok: true; jpegBuffer: Uint8Array }
  | { ok: false; errorMessage?: string };

const TIFF_TIMEOUT_MESSAGE = 'TIFF の変換がタイムアウトしました';
const TIFF_DIMENSIONS_TOO_LARGE_MESSAGE = 'TIFF 画像の解像度が大きすぎます';
const TIFF_OUTPUT_TOO_LARGE_MESSAGE = '変換後の図面画像が大きすぎます';
const TIFF_CONVERT_FAILED_MESSAGE = 'TIFF の変換に失敗しました';

function toKnownTiffApiError(message: string): ApiError | null {
  if (
    message === TIFF_TIMEOUT_MESSAGE ||
    message === TIFF_DIMENSIONS_TOO_LARGE_MESSAGE ||
    message === TIFF_OUTPUT_TOO_LARGE_MESSAGE ||
    message === TIFF_CONVERT_FAILED_MESSAGE
  ) {
    return new ApiError(400, message);
  }
  return null;
}

function buildTiffWorkerSource(): string {
  return `
const { parentPort, workerData } = require('node:worker_threads');
const sharp = require('sharp');

const {
  savedMaxBytes,
  quality,
  limitInputPixels,
  maxHeight,
  maxWidth
} = workerData;

function assertTiffDimensions(width, height) {
  if (width == null || height == null || width <= 0 || height <= 0) {
    throw new Error('TIFF の変換に失敗しました');
  }
  if (width > maxWidth || height > maxHeight) {
    throw new Error('TIFF 画像の解像度が大きすぎます');
  }
}

async function main(buffer) {
  try {
    const metadata = await sharp(buffer, {
      limitInputPixels,
      failOn: 'error'
    }).metadata();
    assertTiffDimensions(metadata.width, metadata.height);

    const jpegBuffer = await sharp(buffer, {
      limitInputPixels,
      failOn: 'error'
    })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    if (jpegBuffer.length > savedMaxBytes) {
      throw new Error('変換後の図面画像が大きすぎます');
    }
    if (jpegBuffer.length === 0) {
      throw new Error('TIFF の変換に失敗しました');
    }

    return { ok: true, jpegBuffer };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

parentPort.on('message', async (buffer) => {
  const result = await main(Buffer.from(buffer));
  parentPort.postMessage(result);
});
`;
}

function convertTiffInWorker(buffer: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const worker = new Worker(buildTiffWorkerSource(), {
      eval: true,
      workerData: {
        savedMaxBytes: PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES,
        quality: PART_MEASUREMENT_TIFF_JPEG_QUALITY,
        limitInputPixels: PART_MEASUREMENT_TIFF_LIMIT_INPUT_PIXELS,
        maxHeight: PART_MEASUREMENT_TIFF_MAX_HEIGHT,
        maxWidth: PART_MEASUREMENT_TIFF_MAX_WIDTH
      }
    });
    let settled = false;
    let terminating = false;
    const finish = async (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (!terminating) {
        terminating = true;
        await worker.terminate().catch(() => undefined);
      }
      fn();
    };
    const timeoutId = setTimeout(() => {
      void finish(() => reject(new ApiError(400, TIFF_TIMEOUT_MESSAGE)));
    }, timeoutMs);

    worker.once('message', (message: unknown) => {
      const result = message as TiffWorkerMessage;
      if (result.ok) {
        void finish(() => resolve(Buffer.from(result.jpegBuffer)));
        return;
      }
      const apiError = toKnownTiffApiError(result.errorMessage ?? TIFF_CONVERT_FAILED_MESSAGE);
      void finish(() => reject(apiError ?? new Error(result.errorMessage ?? TIFF_CONVERT_FAILED_MESSAGE)));
    });
    worker.once('error', (error) => {
      void finish(() => reject(error));
    });
    worker.once('exit', (code) => {
      if (settled || code === 0) {
        return;
      }
      void finish(() => reject(new Error(`TIFF worker exited with code ${code}`)));
    });
    worker.postMessage(buffer);
  });
}

/**
 * TIFF/TIF バッファを JPEG に変換する（先頭フレーム/ページ）。
 */
export async function convertTiffBufferToJpeg(buffer: Buffer): Promise<Buffer> {
  try {
    assertTiffMagic(buffer);
  } catch {
    throw new ApiError(400, 'TIFF ファイルの形式が不正です');
  }

  const run = async (): Promise<Buffer> => {
    try {
      const jpegBuffer = await convertTiffInWorker(buffer, PART_MEASUREMENT_TIFF_CONVERT_TIMEOUT_MS);

      if (jpegBuffer.length > PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES) {
        throw new ApiError(400, '変換後の図面画像が大きすぎます');
      }
      if (jpegBuffer.length === 0) {
        throw new ApiError(400, 'TIFF の変換に失敗しました');
      }
      return jpegBuffer;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw mapSharpTiffFailure(error);
    }
  };

  return withDrawingRasterConvertSlot(run);
}
