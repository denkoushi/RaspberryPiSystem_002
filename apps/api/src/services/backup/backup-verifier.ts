import crypto from 'crypto';
import { gunzipSync } from 'zlib';
import type { BackupTargetInfo } from './backup-types.js';

/**
 * バックアップファイルの整合性検証結果
 */
export interface VerificationResult {
  valid: boolean;
  errors: string[];
  fileSize?: number;
  hash?: string;
}

/**
 * バックアップファイルの整合性検証機能
 */
export class BackupVerifier {
  /**
   * バックアップファイルの整合性を検証
   * @param data バックアップファイルのデータ
   * @param expectedSize 期待されるファイルサイズ（オプション）
   * @param expectedHash 期待されるハッシュ値（オプション）
   * @returns 検証結果
   */
  static verify(
    data: Buffer,
    expectedSize?: number,
    expectedHash?: string
  ): VerificationResult {
    const errors: string[] = [];
    const fileSize = data.length;
    const hash = crypto.createHash('sha256').update(data).digest('hex');

    // ファイルサイズの検証
    if (expectedSize !== undefined && fileSize !== expectedSize) {
      errors.push(
        `File size mismatch: expected ${expectedSize} bytes, got ${fileSize} bytes`
      );
    }

    // ハッシュ値の検証
    if (expectedHash !== undefined && hash !== expectedHash) {
      errors.push(
        `Hash mismatch: expected ${expectedHash}, got ${hash}`
      );
    }

    // 空ファイルの検証
    if (fileSize === 0) {
      errors.push('File is empty');
    }

    return {
      valid: errors.length === 0,
      errors,
      fileSize,
      hash
    };
  }

  /**
   * バックアップファイルのハッシュ値を計算
   * @param data バックアップファイルのデータ
   * @returns SHA256ハッシュ値
   */
  static calculateHash(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * バックアップファイルの形式を検証
   * @param data バックアップファイルのデータ
   * @param targetInfo バックアップターゲット情報
   * @returns 検証結果
   */
  static verifyFormat(
    data: Buffer,
    targetInfo: BackupTargetInfo
  ): VerificationResult {
    const errors: string[] = [];

    if (targetInfo.type === 'database') {
      // データベースバックアップの検証（pg_dump形式）
      let databaseData = data;
      if (this.isGzipData(data)) {
        try {
          databaseData = gunzipSync(data);
        } catch {
          errors.push('Invalid database backup format: gzip decompression failed');
        }
      }
      const content = databaseData.toString('utf-8', 0, Math.min(100, databaseData.length));
      // pg_dump形式は通常"--"で始まるか、"PostgreSQL database dump"を含む
      if (!content.includes('PostgreSQL database dump') && !content.trim().startsWith('--')) {
        errors.push('Invalid database backup format: expected pg_dump format');
      }
    } else if (targetInfo.type === 'csv') {
      // CSVバックアップの検証
      const content = data.toString('utf-8');
      // CSV形式はカンマまたは改行を含む必要がある（空でない場合）
      // ただし、単一行のCSV（ヘッダーのみ）も許可する
      if (content.length > 0 && !content.includes(',') && !content.includes('\n') && !content.includes('\r')) {
        errors.push('Invalid CSV format: expected comma-separated values');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      fileSize: data.length
    };
  }

  private static isGzipData(data: Buffer): boolean {
    return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  }
}
