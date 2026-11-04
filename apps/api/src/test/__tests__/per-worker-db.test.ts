import { describe, expect, it } from 'vitest';

import {
  applyPerWorkerTestEnv,
  assertDisposableDatabaseUrl,
  workerDatabaseUrl,
  workerDirPath,
  workerFilePath,
} from '../per-worker-db.js';

describe('per-worker test database routing', () => {
  it('changes only the database name and keeps the loopback host required by integration guards', () => {
    const url = workerDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/borrow_return?connection_limit=5', 3);
    expect(url).toBe('postgresql://postgres:postgres@127.0.0.1:5432/borrow_return_w3?connection_limit=5');
    expect(url).toMatch(/^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:\d+\//);
  });

  it('derives sibling storage paths per worker', () => {
    expect(workerDirPath('/tmp/test-file-storage', 2)).toBe('/tmp/test-file-storage-w2');
    expect(workerDirPath('/tmp/test-backups/', 2)).toBe('/tmp/test-backups-w2');
    expect(workerFilePath('/tmp/test-backup.json', 2)).toBe('/tmp/test-backup-w2.json');
    expect(workerFilePath('/tmp/backup-config', 2)).toBe('/tmp/backup-config-w2');
  });

  it('leaves the environment untouched unless the opt-in flag is set', () => {
    const env: NodeJS.ProcessEnv = {
      VITEST_POOL_ID: '1',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/borrow_return',
      FILE_STORAGE_ROOT: '/tmp/test-file-storage',
    };
    applyPerWorkerTestEnv(env);
    expect(env.DATABASE_URL).toBe('postgresql://postgres:postgres@127.0.0.1:5432/borrow_return');
    expect(env.FILE_STORAGE_ROOT).toBe('/tmp/test-file-storage');
  });

  it('rewrites the database and every storage setting exactly once when opted in', () => {
    const env: NodeJS.ProcessEnv = {
      API_TEST_PER_WORKER_DB: '1',
      VITEST_POOL_ID: '4',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/borrow_return',
      FILE_STORAGE_ROOT: '/tmp/test-file-storage',
      PDF_STORAGE_DIR: '/tmp/test-file-storage',
      PHOTO_STORAGE_DIR: '/tmp/test-file-storage',
      BACKUP_STORAGE_DIR: '/tmp/test-backups',
      BACKUP_CONFIG_PATH: '/tmp/test-backup.json',
    };
    applyPerWorkerTestEnv(env);
    applyPerWorkerTestEnv(env);
    expect(env).toMatchObject({
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/borrow_return_w4',
      FILE_STORAGE_ROOT: '/tmp/test-file-storage-w4',
      PDF_STORAGE_DIR: '/tmp/test-file-storage-w4',
      PHOTO_STORAGE_DIR: '/tmp/test-file-storage-w4',
      BACKUP_STORAGE_DIR: '/tmp/test-backups-w4',
      BACKUP_CONFIG_PATH: '/tmp/test-backup-w4.json',
    });
  });

  it('refuses to clone databases on a non-loopback server', () => {
    expect(() => assertDisposableDatabaseUrl('postgresql://postgres:postgres@db:5432/borrow_return')).toThrow(
      /loopback/,
    );
    expect(() => assertDisposableDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:5432/')).toThrow(/name a database/);
    expect(() => assertDisposableDatabaseUrl('postgresql://postgres:postgres@localhost:5432/borrow_return')).not.toThrow();
  });
});
