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
import { resolveDatabaseBackupSource } from '../backup-database-source.js';

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/borrow_return';

/**
 * PostgreSQLのダンプを取得するターゲット。
 * pg_dump が実行可能であることを前提とする。
 */
export class DatabaseBackupTarget implements BackupTarget {
  private readonly connectionUrl: string;
  private readonly sourceName: string;

  constructor(dbUrl?: string) {
    // dbUrlが指定されていない場合、またはlocalhostを含む場合は環境変数DATABASE_URLを使用
    // Dockerコンテナ内ではdb:5432を使用する必要があるため
    if (!dbUrl || dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
      this.connectionUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
    } else {
      // dbUrlがデータベース接続文字列でない場合（データベース名のみの場合）、環境変数DATABASE_URLを使用
      // データベース接続文字列はpostgresql://で始まる
      if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
        // データベース名のみの場合は、環境変数DATABASE_URLのデータベース名部分を置き換える
        const baseUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
        try {
          const url = new URL(baseUrl);
          url.pathname = `/${dbUrl}`;
          this.connectionUrl = url.toString();
        } catch {
          // URL解析に失敗した場合は環境変数DATABASE_URLを使用
          this.connectionUrl = process.env.DATABASE_URL || DEFAULT_DB_URL;
        }
      } else {
        this.connectionUrl = dbUrl;
      }
    }

    this.sourceName = resolveDatabaseBackupSource(dbUrl, this.connectionUrl);
  }

  get info(): BackupTargetInfo {
    return {
      type: 'database',
      source: this.sourceName
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
        // Extensions are provisioned separately and may be owned by postgres.
        // Keep them installed while restoring the migrator-owned application objects.
        ['-h', host, '-p', port, '-U', user, '--clean', '--if-exists', '--exclude-extension=vector', '--exclude-extension=pg_trgm', dbName],
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
        pipeline(pgDump.stdout, createGzip(), createWriteStream(tempFilePath, { mode: 0o600 }))
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
    const url = new URL(this.connectionUrl);
    const dbName = url.pathname.replace(/^\//, '');
    const user = decodeURIComponent(url.username || 'postgres');
    const host = url.hostname || 'localhost';
    const port = url.port || '5432';
    const password = url.password ? decodeURIComponent(url.password) : undefined;
    return { dbName, user, host, port, password };
  }

  async restore(backupData: Buffer, options?: RestoreOptions): Promise<RestoreResult> {
    void options;
    const connection = this.getConnectionInfo();
    const { dbName, host, port } = connection;
    let { user, password } = connection;
    const restoreUrl = process.env.BACKUP_RESTORE_DATABASE_URL;
    if (!restoreUrl?.trim()) {
      if (process.env.NODE_ENV === 'production') {
        throw new ApiError(500, 'DB復元には所有者権限の接続設定 BACKUP_RESTORE_DATABASE_URL が必要です。Ansibleの設定を再適用してください。');
      }
    } else {
      try {
        const credentials = new URL(restoreUrl);
        const runtime = new URL(process.env.DATABASE_URL || this.connectionUrl);
        if (
          !['postgresql:', 'postgres:'].includes(credentials.protocol) ||
          !credentials.username || !credentials.password ||
          credentials.hostname !== runtime.hostname ||
          (credentials.port || '5432') !== (runtime.port || '5432') ||
          credentials.pathname !== runtime.pathname ||
          credentials.hostname !== host ||
          (credentials.port || '5432') !== port ||
          credentials.pathname !== `/${dbName}`
        ) {
          throw new Error('Invalid restore connection');
        }
        // 復元先と接続オプションは変更せず、所有者の認証情報だけを使う。
        user = decodeURIComponent(credentials.username);
        password = decodeURIComponent(credentials.password);
        if (user.includes('\0') || password.includes('\0')) {
          throw new Error('Invalid restore credentials');
        }
      } catch {
        throw new ApiError(500, 'BACKUP_RESTORE_DATABASE_URL が不正、または接続先のホスト・ポート・DB名が DATABASE_URL／復元対象と一致しません。所有者のユーザー・パスワードを同じ接続先で設定してください。');
      }
    }

    const redactPassword = (message: string): string => {
      if (!password) return message;
      return message.split(password).join('[REDACTED]').split(encodeURIComponent(password)).join('[REDACTED]');
    };

    const env = { ...process.env };
    env.PGPASSWORD = password || '';

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

      const args = ['-h', host, '-p', port, '-U', user, '-d', dbName, '--no-psqlrc', '--set', 'ON_ERROR_STOP=on', '--single-transaction', '-f', '-'];
      if (connection.user === 'raspi_app' && user !== connection.user) {
        // Existing default privileges grant CRUD when the dump recreates this
        // table; its GRANT SELECT alone does not revoke those inherited writes.
        args.push('-c', 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."_prisma_migrations" FROM raspi_app;');
      }
      const psql = spawn('psql', args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const errors: string[] = [];
      psql.stderr.on('data', (data: Buffer) => {
        errors.push(data.toString('utf-8'));
      });

      psql.on('close', (code) => {
        if (code !== 0) {
          const detail = redactPassword(errors.join(''));
          logger?.error({ detail, code }, '[DatabaseBackupTarget] Database restore failed');
          rejectOnce(new ApiError(500, `Database restore failed: ${detail || 'psqlが異常終了しました。'}`));
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
        const detail = redactPassword(error.message);
        logger?.error({ detail }, '[DatabaseBackupTarget] Failed to spawn psql');
        rejectOnce(new ApiError(500, `Failed to spawn psql: ${detail}`));
      });

      // バックアップデータをstdinに書き込む。gzip済みDBバックアップも復元できるようにする。
      const inputStream = this.createRestoreInputStream(backupData);
      psql.stdin.on('error', (error: NodeJS.ErrnoException) => {
        inputStream.destroy();
        // ON_ERROR_STOPでpsqlが先に終了した場合は、closeでSQLエラーを報告する。
        if (error.code === 'EPIPE') return;
        psql.kill('SIGTERM');
        rejectOnce(new ApiError(500, `Database restore input failed: ${redactPassword(error.message)}`));
      });
      inputStream.on('error', (error) => {
        const detail = redactPassword(error.message);
        logger?.error({ detail }, '[DatabaseBackupTarget] Failed to read restore backup stream');
        psql.kill('SIGTERM');
        rejectOnce(new ApiError(500, `Database restore input failed: ${detail}`));
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
