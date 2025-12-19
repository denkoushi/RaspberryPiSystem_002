import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo, RestoreOptions, RestoreResult } from '../backup-types.js';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';

const execFileAsync = promisify(execFile);

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
      this.dbUrl = dbUrl;
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

    try {
      const { stdout } = await execFileAsync(
        'pg_dump',
        ['-h', host, '-p', port, '-U', user, '--clean', '--if-exists', dbName],
        {
          env,
          maxBuffer: 1024 * 1024 * 200,
          encoding: 'buffer'
        }
      );

      return stdout;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ApiError(
          500,
          `pg_dumpコマンドが見つかりません。データベースバックアップにはpg_dumpが必要です。Dockerコンテナ内にpg_dumpがインストールされていることを確認してください。`
        );
      }
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as { stderr?: string }).stderr || '';
        throw new ApiError(500, `データベースバックアップに失敗しました: ${error.message}${stderr ? `\n${stderr}` : ''}`);
      }
      throw error;
    }
  }

  async restore(backupData: Buffer, _options?: RestoreOptions): Promise<RestoreResult> { // eslint-disable-line @typescript-eslint/no-unused-vars
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
          reject(new ApiError(500, `Database restore failed: ${errors.join(', ')}`));
        } else {
          logger?.info({ dbName }, '[DatabaseBackupTarget] Database restore completed');
          resolve({
            backupId: dbName,
            success: true,
            timestamp: new Date()
          });
        }
      });

      psql.on('error', (error) => {
        logger?.error({ err: error }, '[DatabaseBackupTarget] Failed to spawn psql');
        reject(new ApiError(500, `Failed to spawn psql: ${error.message}`));
      });

      // バックアップデータをstdinに書き込む
      const inputStream = Readable.from(backupData);
      inputStream.pipe(psql.stdin);
      inputStream.on('end', () => {
        psql.stdin.end();
      });
    });
  }
}

