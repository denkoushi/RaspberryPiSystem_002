import { promises as fs } from 'fs';
import path from 'path';
import { cameraConfig } from '../config/camera.config.js';

/**
 * 写真保存のベースディレクトリ
 */
const STORAGE_BASE_DIR = process.env.PHOTO_STORAGE_DIR || '/opt/RaspberryPiSystem_002/storage';
const PHOTOS_DIR = path.join(STORAGE_BASE_DIR, 'photos');
const THUMBNAILS_DIR = path.join(STORAGE_BASE_DIR, 'thumbnails');

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
    await fs.mkdir(PHOTOS_DIR, { recursive: true });
    await fs.mkdir(THUMBNAILS_DIR, { recursive: true });
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
    const fullPath = path.join(PHOTOS_DIR, yearMonthDir, filename);
    const thumbnailPath = path.join(THUMBNAILS_DIR, yearMonthDir, thumbnailFilename);

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
    const yearMonthDir = path.join(PHOTOS_DIR, pathInfo.year, pathInfo.month);
    const thumbnailYearMonthDir = path.join(THUMBNAILS_DIR, pathInfo.year, pathInfo.month);
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
    // URLからファイルパスを抽出
    // /api/storage/photos/YYYY/MM/filename.jpg -> /opt/RaspberryPiSystem_002/storage/photos/YYYY/MM/filename.jpg
    const relativePath = photoUrl.replace('/api/storage/photos/', '');
    const fullPath = path.join(PHOTOS_DIR, relativePath);

    // サムネイルのパスも生成
    const thumbnailRelativePath = photoUrl
      .replace('/api/storage/photos/', '/storage/thumbnails/')
      .replace('.jpg', '_thumb.jpg');
    const thumbnailFullPath = thumbnailRelativePath.replace('/storage/thumbnails/', THUMBNAILS_DIR + '/');

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

    const yearDir = path.join(PHOTOS_DIR, targetYear.toString(), targetMonth);
    const thumbnailYearDir = path.join(THUMBNAILS_DIR, targetYear.toString(), targetMonth);

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
    // URLからファイルパスを抽出
    const relativePath = photoUrl.replace('/api/storage/photos/', '');
    const fullPath = path.join(PHOTOS_DIR, relativePath);

    return await fs.readFile(fullPath);
  }
}

