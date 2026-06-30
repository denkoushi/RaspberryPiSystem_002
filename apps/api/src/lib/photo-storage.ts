import { promises as fs } from 'fs';
import path from 'path';

import sharp from 'sharp';

const getStorageBaseDir = () =>
  process.env.PHOTO_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');
const getPhotosDir = () => path.join(getStorageBaseDir(), 'photos');
const getThumbnailsDir = () => path.join(getStorageBaseDir(), 'thumbnails');
const PHOTO_PUBLIC_PREFIX = '/api/storage/photos/';

const resolvePathInside = (baseDir: string, relativePath: string): string => {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid photo path');
  }

  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
    throw new Error('Invalid photo path');
  }

  const base = path.resolve(baseDir);
  const fullPath = path.resolve(base, normalized);
  if (fullPath !== base && !fullPath.startsWith(`${base}${path.sep}`)) {
    throw new Error('Invalid photo path');
  }

  return fullPath;
};

const extractPhotoRelativePath = (photoUrl: string): string => {
  if (!photoUrl.startsWith(PHOTO_PUBLIC_PREFIX)) {
    throw new Error(`Invalid photoUrl: ${photoUrl}`);
  }

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(photoUrl.slice(PHOTO_PUBLIC_PREFIX.length));
  } catch {
    throw new Error('Invalid photo path');
  }
  if (!relativePath || relativePath.includes('/') === false) {
    throw new Error('Invalid photo path');
  }
  return path.normalize(relativePath);
};

/**
 * 写真ファイルのパス情報
 */
export interface PhotoPathInfo {
  year: string; // YYYY
  month: string; // MM
  filename: string; // YYYYMMDD_HHMMSS_{employeeId}.jpg
  thumbnailFilename: string; // YYYYMMDD_HHMMSS_{employeeId}_thumb.jpg
  fullPath: string; // 元画像のフルパス
  thumbnailPath: string; // サムネイルのフルパス
  relativePath: string; // API経由でアクセスする相対パス
  thumbnailRelativePath: string; // Caddy経由でアクセスする相対パス
}

/**
 * 写真ストレージユーティリティ
 * 
 * 写真の保存・削除・パス生成を提供する。
 */
export class PhotoStorage {
  /**
   * ストレージディレクトリを初期化する
   */
  static async initialize(): Promise<void> {
    await fs.mkdir(getPhotosDir(), { recursive: true });
    await fs.mkdir(getThumbnailsDir(), { recursive: true });
  }

  /**
   * 写真ファイルのパス情報を生成する
   * 
   * @param employeeId 従業員ID
   * @returns パス情報
   */
  static generatePhotoPath(employeeId: string): PhotoPathInfo {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${year}${month}${day}_${hour}${minute}${second}`;
    const filename = `${timestamp}_${employeeId}.jpg`;
    const thumbnailFilename = `${timestamp}_${employeeId}_thumb.jpg`;

    const yearMonthDir = path.join(year, month);
    const fullPath = path.join(getPhotosDir(), yearMonthDir, filename);
    const thumbnailPath = path.join(getThumbnailsDir(), yearMonthDir, thumbnailFilename);

    // API経由でアクセスする相対パス
    const relativePath = `/api/storage/photos/${yearMonthDir}/${filename}`;
    // Caddy経由でアクセスする相対パス
    const thumbnailRelativePath = `/storage/thumbnails/${yearMonthDir}/${thumbnailFilename}`;

    return {
      year,
      month,
      filename,
      thumbnailFilename,
      fullPath,
      thumbnailPath,
      relativePath,
      thumbnailRelativePath,
    };
  }

  /**
   * 写真を保存する
   * 
   * @param employeeId 従業員ID
   * @param originalImage 元画像のBuffer
   * @param thumbnailImage サムネイル画像のBuffer
   * @returns パス情報
   */
  static async savePhoto(
    employeeId: string,
    originalImage: Buffer,
    thumbnailImage: Buffer
  ): Promise<PhotoPathInfo> {
    const pathInfo = this.generatePhotoPath(employeeId);

    // ディレクトリを作成（存在しない場合）
    const yearMonthDir = path.join(getPhotosDir(), pathInfo.year, pathInfo.month);
    const thumbnailYearMonthDir = path.join(getThumbnailsDir(), pathInfo.year, pathInfo.month);
    await fs.mkdir(yearMonthDir, { recursive: true });
    await fs.mkdir(thumbnailYearMonthDir, { recursive: true });

    // ファイルを保存
    await fs.writeFile(pathInfo.fullPath, originalImage);
    await fs.writeFile(pathInfo.thumbnailPath, thumbnailImage);

    return pathInfo;
  }

  /**
   * 写真を削除する
   * 
   * @param photoUrl 写真のURL（例: /api/storage/photos/2025/11/20251127_123456_employee-uuid.jpg）
   */
  static async deletePhoto(photoUrl: string): Promise<void> {
    const relativePath = extractPhotoRelativePath(photoUrl);
    const fullPath = resolvePathInside(getPhotosDir(), relativePath);

    // サムネイルのパスも生成
    const thumbnailRelativePath = relativePath.replace(/\.jpe?g$/i, '_thumb.jpg');
    const thumbnailFullPath = resolvePathInside(getThumbnailsDir(), thumbnailRelativePath);

    // ファイルを削除（存在しない場合はエラーを無視）
    try {
      await fs.unlink(fullPath);
    } catch (error) {
      // ファイルが存在しない場合は無視
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      await fs.unlink(thumbnailFullPath);
    } catch (error) {
      // ファイルが存在しない場合は無視
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * 指定年の2年後の1月に該当する写真を削除する
   * 
   * @param year 撮影年（例: 2025）
   */
  static async deletePhotosByYear(year: number): Promise<number> {
    const targetYear = year + 2; // 2年後
    const targetMonth = '01'; // 1月

    const yearDir = path.join(getPhotosDir(), targetYear.toString(), targetMonth);
    const thumbnailYearDir = path.join(getThumbnailsDir(), targetYear.toString(), targetMonth);

    let deletedCount = 0;

    try {
      // 元画像を削除
      const files = await fs.readdir(yearDir);
      for (const file of files) {
        if (file.endsWith('.jpg') && !file.endsWith('_thumb.jpg')) {
          await fs.unlink(path.join(yearDir, file));
          deletedCount++;
        }
      }

      // サムネイルを削除
      const thumbnailFiles = await fs.readdir(thumbnailYearDir);
      for (const file of thumbnailFiles) {
        if (file.endsWith('_thumb.jpg')) {
          await fs.unlink(path.join(thumbnailYearDir, file));
        }
      }
    } catch (error) {
      // ディレクトリが存在しない場合は無視
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    return deletedCount;
  }

  /**
   * 写真ファイルを読み込む
   * 
   * @param photoUrl 写真のURL（例: /api/storage/photos/2025/11/20251127_123456_employee-uuid.jpg）
   * @returns 画像のBuffer
   */
  static async readPhoto(photoUrl: string): Promise<Buffer> {
    const relativePath = extractPhotoRelativePath(photoUrl);
    const fullPath = resolvePathInside(getPhotosDir(), relativePath);

    return await fs.readFile(fullPath);
  }

  /**
   * 元画像の photoUrl に対応するサムネイル JPEG を読み込む
   * （`deletePhoto` と同じパス規則。`signage.service` の buildThumbnailUrl と整合）
   */
  static async readThumbnailBuffer(photoUrl: string): Promise<Buffer> {
    const relativePath = extractPhotoRelativePath(photoUrl);
    const thumbnailRelativePath = relativePath.replace(/\.jpe?g$/i, '_thumb.jpg');
    const thumbnailFullPath = resolvePathInside(getThumbnailsDir(), thumbnailRelativePath);
    return await fs.readFile(thumbnailFullPath);
  }

  /**
   * VLM 推論用: 本画像を読み、長辺上限でサイズ内に収めて JPEG 化する。
   * （キオ斯克表示用サムネより解像度を確保する）
   */
  static async readVisionInferenceJpeg(
    photoUrl: string,
    opts: { maxLongEdge: number; jpegQuality: number }
  ): Promise<Buffer> {
    if (!photoUrl.startsWith('/api/storage/photos/')) {
      throw new Error(`Invalid photoUrl for vision inference: ${photoUrl}`);
    }
    const raw = await this.readPhoto(photoUrl);
    return sharp(raw)
      .resize(opts.maxLongEdge, opts.maxLongEdge, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: opts.jpegQuality })
      .toBuffer();
  }
}
