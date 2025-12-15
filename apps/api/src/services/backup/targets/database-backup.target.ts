import { execFile } from 'child_process';
import { promisify } from 'util';
import type { BackupTarget } from '../backup-target.interface.js';
import type { BackupTargetInfo } from '../backup-types.js';

const execFileAsync = promisify(execFile);

const DEFAULT_DB_URL = 'postgresql://postgres:postgres@localhost:5432/borrow_return';

/**
 * PostgreSQLのダンプを取得するターゲット。
 * pg_dump が実行可能であることを前提とする。
 */
export class DatabaseBackupTarget implements BackupTarget {
  constructor(private readonly dbUrl: string = process.env.DATABASE_URL || DEFAULT_DB_URL) {}

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
  }
}

