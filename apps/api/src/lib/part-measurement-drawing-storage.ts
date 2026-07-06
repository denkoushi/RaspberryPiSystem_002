import { randomUUID } from 'crypto';
import { promises as fs, type Stats } from 'fs';
import path from 'path';
import sharp from 'sharp';

const getStorageBaseDir = () =>
  process.env.PHOTO_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');

const getDrawingsDir = () => path.join(getStorageBaseDir(), 'part-measurement-drawings');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp'
};

const MAX_BYTES = 12 * 1024 * 1024;

const DRAWING_URL_PREFIX = '/api/storage/part-measurement-drawings/';

export const ALLOWED_DERIVATIVE_WIDTHS = [1280, 1920, 2560] as const;
export type DerivativeWidth = (typeof ALLOWED_DERIVATIVE_WIDTHS)[number];

const DERIVATIVE_WEBP_QUALITY = 80;

const derivativeGenerationInFlight = new Map<string, Promise<void>>();

export function parseDerivativeWidth(raw: unknown): DerivativeWidth | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const parsed = typeof raw === 'number' ? raw : Number(String(raw));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return (ALLOWED_DERIVATIVE_WIDTHS as readonly number[]).includes(parsed)
    ? (parsed as DerivativeWidth)
    : null;
}

/** @internal test helper */
export function resetPartMeasurementDrawingDerivativeInFlightForTests(): void {
  derivativeGenerationInFlight.clear();
}

function getDerivativesDir(width: DerivativeWidth): string {
  return path.join(getStorageBaseDir(), 'part-measurement-drawings-derivatives', `w${width}`);
}

function resolveDerivativeFile(sourceFilename: string, width: DerivativeWidth): string {
  return path.join(getDerivativesDir(width), `${sourceFilename}.webp`);
}

function derivativeGenerationKey(sourceFullPath: string, width: DerivativeWidth): string {
  return `${sourceFullPath}:${width}`;
}

async function generateDerivativeWebp(
  sourceFullPath: string,
  derivativeFullPath: string,
  width: DerivativeWidth
): Promise<void> {
  await fs.mkdir(path.dirname(derivativeFullPath), { recursive: true });
  await sharp(sourceFullPath, { failOn: 'none' })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: DERIVATIVE_WEBP_QUALITY })
    .toFile(derivativeFullPath);
}

async function ensureDerivativeFile(
  sourceFullPath: string,
  sourceFilename: string,
  width: DerivativeWidth,
  sourceMtimeMs: number
): Promise<string> {
  const derivativeFullPath = resolveDerivativeFile(sourceFilename, width);
  try {
    const derivativeStat = await fs.stat(derivativeFullPath);
    if (derivativeStat.mtimeMs >= sourceMtimeMs) {
      return derivativeFullPath;
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }

  const inFlightKey = derivativeGenerationKey(sourceFullPath, width);
  const inFlight = derivativeGenerationInFlight.get(inFlightKey);
  if (inFlight) {
    await inFlight;
    return derivativeFullPath;
  }

  const generationPromise = (async () => {
    try {
      const derivativeStat = await fs.stat(derivativeFullPath).catch(() => null);
      if (!derivativeStat || derivativeStat.mtimeMs < sourceMtimeMs) {
        await generateDerivativeWebp(sourceFullPath, derivativeFullPath, width);
      }
    } finally {
      derivativeGenerationInFlight.delete(inFlightKey);
    }
  })();

  derivativeGenerationInFlight.set(inFlightKey, generationPromise);
  await generationPromise;
  return derivativeFullPath;
}

function resolveDrawingFile(relativeUrl: string): { fullPath: string; contentType: string } {
  if (!relativeUrl.startsWith(DRAWING_URL_PREFIX)) {
    throw new Error('Invalid drawing URL');
  }
  const filename = relativeUrl.slice(DRAWING_URL_PREFIX.length);
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid drawing path');
  }
  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'application/octet-stream';
  const fullPath = path.join(getDrawingsDir(), filename);
  return { fullPath, contentType };
}

/**
 * 部品測定 visual template 用の図面画像（1枚）を保存・読み込みする。
 * 配信 URL は `/api/storage/part-measurement-drawings/{uuid}{ext}` とする。
 */
export class PartMeasurementDrawingStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getDrawingsDir(), { recursive: true });
  }

  static assertMime(mimetype: string): string {
    const ext = MIME_TO_EXT[mimetype.toLowerCase()];
    if (!ext) {
      throw new Error(`サポートしていない画像形式です: ${mimetype}`);
    }
    return ext;
  }

  static getMaxBytes(): number {
    return MAX_BYTES;
  }

  /**
   * バッファを保存し、API 経由で参照する相対 URL を返す。
   */
  static async saveDrawing(buffer: Buffer, mimetype: string): Promise<{ relativeUrl: string; contentType: string }> {
    if (buffer.length > MAX_BYTES) {
      throw new Error(`画像サイズが大きすぎます（最大 ${MAX_BYTES} バイト）`);
    }
    const ext = this.assertMime(mimetype);
    const id = randomUUID();
    const filename = `${id}${ext}`;
    const fullPath = path.join(getDrawingsDir(), filename);
    await fs.mkdir(getDrawingsDir(), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      relativeUrl: `/api/storage/part-measurement-drawings/${filename}`,
      contentType: mimetype.toLowerCase().startsWith('image/') ? mimetype : 'application/octet-stream'
    };
  }

  /**
   * `/api/storage/part-measurement-drawings/...` からファイル名部分を除いたパスを解決して読み込む。
   */
  static async statDrawing(relativeUrl: string): Promise<Stats> {
    const { fullPath } = resolveDrawingFile(relativeUrl);
    return fs.stat(fullPath);
  }

  static async readDrawing(relativeUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const { fullPath, contentType } = resolveDrawingFile(relativeUrl);
    const buffer = await fs.readFile(fullPath);
    return { buffer, contentType };
  }

  /**
   * 表示用のリサイズ済み WebP 派生画像を返す。元幅が要求幅以下なら原寸を返す。
   */
  static async readDrawingDerivative(
    relativeUrl: string,
    width: DerivativeWidth
  ): Promise<{ buffer: Buffer; contentType: string; stat: Stats }> {
    const { fullPath, contentType } = resolveDrawingFile(relativeUrl);
    const sourceStat = await fs.stat(fullPath);
    const metadata = await sharp(fullPath, { failOn: 'none' }).metadata();
    const sourceWidth = metadata.width ?? 0;

    if (sourceWidth > 0 && sourceWidth <= width) {
      const buffer = await fs.readFile(fullPath);
      return { buffer, contentType, stat: sourceStat };
    }

    const sourceFilename = relativeUrl.slice(DRAWING_URL_PREFIX.length);
    const derivativeFullPath = await ensureDerivativeFile(
      fullPath,
      sourceFilename,
      width,
      sourceStat.mtimeMs
    );
    const [buffer, stat] = await Promise.all([fs.readFile(derivativeFullPath), fs.stat(derivativeFullPath)]);
    return { buffer, contentType: 'image/webp', stat };
  }

  /** 保存に失敗した図面ファイルのロールバック用（未参照時のみ呼ぶ） */
  static async deleteDrawing(relativeUrl: string): Promise<void> {
    try {
      const { fullPath } = resolveDrawingFile(relativeUrl);
      await fs.unlink(fullPath).catch(() => undefined);
    } catch {
      return;
    }
  }
}
