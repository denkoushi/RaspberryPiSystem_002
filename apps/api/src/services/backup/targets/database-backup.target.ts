import { randomUUID } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip, createGzip } from 'zlib';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo, RestoreOptions, RestoreResult } from '../backup-types.js';
import type { UploadSource } from '../storage/storage-provider.interface.js';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/borrow_return';

/**
 * PostgreSQLのダンプを取得するターゲット。
 * pg_dump が実行可能であることを前提とする。
 */
export class DatabaseBackupTarget implements BackupTarget {
  private readonly dbUrl: string;

  constructor(dbUrl?: string) {
    // dbUrlが指定されていない場合、またはlocalhostを含む場合は環境変数DATABASE_URLを使用
    // Dockerコンテナ内ではdb:5432を使用する必要があるため
    if (!dbUrl || dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
      this.dbUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
    } else {
      // dbUrlがデータベース接続文字列でない場合（データベース名のみの場合）、環境変数DATABASE_URLを使用
      // データベース接続文字列はpostgresql://で始まる
      if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
        // データベース名のみの場合は、環境変数DATABASE_URLのデータベース名部分を置き換える
        const baseUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
        try {
          const url = new URL(baseUrl);
          url.pathname = `/${dbUrl}`;
          this.dbUrl = url.toString();
        } catch {
          // URL解析に失敗した場合は環境変数DATABASE_URLを使用
          this.dbUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
        }
      } else {
        this.dbUrl = dbUrl;
      }
    }
  }

  get info(): BackupTargetInfo {
    const url = new URL(this.dbUrl);
    return {
      type: 'database',
      source: url.pathname.replace(/^\//, '') || 'database'
    };
  }

  async createBackup(): Promise<Buffer> {
    const source = await this.createUploadSource();
    if (source.kind !== 'file') {
      return source.data;
    }
    try {
      return await fs.readFile(source.filePath);
    } finally {
      await source.cleanup?.().catch(() => {});
    }
  }

  async createUploadSource(): Promise<UploadSource> {
    const tempFilePath = await this.dumpToTempFile();
    const stat = await fs.stat(tempFilePath);
    return {
      kind: 'file',
      filePath: tempFilePath,
      sizeBytes: stat.size,
      cleanup: async () => {
        await fs.rm(tempFilePath, { force: true }).catch(() => {});
      }
    };
  }

  private async dumpToTempFile(): Promise<string> {
    const { dbName, user, host, port, password } = this.getConnectionInfo();
    const env = { ...process.env };
    if (password) {
      env.PGPASSWORD = password;
    }

    const tempFilePath = path.join(os.tmpdir(), `db-backup-${dbName}-${Date.now()}-${randomUUID()}.sql.gz`);

    try {
      const pgDump = spawn(
        'pg_dump',
        ['-h', host, '-p', port, '-U', user, '--clean', '--if-exists', dbName],
        {
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      const errors: string[] = [];
      pgDump.stderr.on('data', (chunk: Buffer) => {
        errors.push(chunk.toString('utf-8'));
      });

      const exitPromise = new Promise<void>((resolve, reject) => {
        pgDump.on('error', (error) => {
          pgDump.stdout.destroy(error);
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new ApiError(500, 'pg_dumpコマンドが見つかりません。Dockerコンテナ内にpg_dumpが必要です。'));
            return;
          }
          reject(error);
        });

        pgDump.on('close', (code) => {
          if (code !== 0) {
            reject(new ApiError(500, `データベースバックアップに失敗しました: ${errors.join('')}`));
            return;
          }
          resolve();
        });
      });

      await Promise.all([
        exitPromise,
        pipeline(pgDump.stdout, createGzip(), createWriteStream(tempFilePath))
      ]);
    } catch (error) {
      await fs.rm(tempFilePath, { force: true }).catch(() => {});
      throw error;
    }

    return tempFilePath;
  }

  private getConnectionInfo(): {
    dbName: string;
    user: string;
    host: string;
    port: string;
    password?: string;
  } {
    const url = new URL(this.dbUrl);
    const dbName = url.pathname.replace(/^\//, '');
    const user = decodeURIComponent(url.username || 'postgres');
    const host = url.hostname || 'localhost';
    const port = url.port || '5432';
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    return { dbName, user, host, port, password };
  }

  async restore(backupData: Buffer, options?: RestoreOptions): Promise<RestoreResult> {
    void options;
    const url = new URL(this.dbUrl);
    const dbName = url.pathname.replace(/^\//, '');
    const user = decodeURIComponent(url.username || 'postgres');
    const host = url.hostname || 'localhost';
    const port = url.port || '5432';
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    const env = { ...process.env };
    if (password) {
      env.PGPASSWORD = password;
    }

    logger?.info({ dbName, host, port }, '[DatabaseBackupTarget] Restoring database from backup');

    return new Promise<RestoreResult>((resolve, reject) => {
      let settled = false;
      const resolveOnce = (result: RestoreResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const psql = spawn('psql', ['-h', host, '-p', port, '-U', user, '-d', dbName, '--set', 'ON_ERROR_STOP=off'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const errors: string[] = [];
      psql.stderr.on('data', (data: Buffer) => {
        const errorMsg = data.toString('utf-8');
        // 警告メッセージは無視（エラーとして扱わない）
        if (!errorMsg.includes('WARNING') && !errorMsg.includes('NOTICE')) {
          errors.push(errorMsg);
        }
      });

      psql.on('close', (code) => {
        if (code !== 0 && errors.length > 0) {
          logger?.error({ errors, code }, '[DatabaseBackupTarget] Database restore failed');
          rejectOnce(new ApiError(500, `Database restore failed: ${errors.join(', ')}`));
        } else {
          logger?.info({ dbName }, '[DatabaseBackupTarget] Database restore completed');
          resolveOnce({
            backupId: dbName,
            success: true,
            timestamp: new Date()
          });
        }
      });

      psql.on('error', (error) => {
        logger?.error({ err: error }, '[DatabaseBackupTarget] Failed to spawn psql');
        rejectOnce(new ApiError(500, `Failed to spawn psql: ${error.message}`));
      });

      // バックアップデータをstdinに書き込む。gzip済みDBバックアップも復元できるようにする。
      const inputStream = this.createRestoreInputStream(backupData);
      inputStream.on('error', (error) => {
        logger?.error({ err: error }, '[DatabaseBackupTarget] Failed to read restore backup stream');
        psql.kill('SIGTERM');
        rejectOnce(new ApiError(500, `Database restore input failed: ${error.message}`));
      });
      inputStream.pipe(psql.stdin);
    });
  }

  private createRestoreInputStream(backupData: Buffer): Readable {
    const input = Readable.from(backupData);
    if (this.isGzipData(backupData)) {
      return input.pipe(createGunzip());
    }
    return input;
  }

  private isGzipData(data: Buffer): boolean {
    return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  }
}
