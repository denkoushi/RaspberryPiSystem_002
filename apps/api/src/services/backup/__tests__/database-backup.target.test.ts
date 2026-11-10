import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { PassThrough } from 'stream';
import { gzipSync, gunzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('dotenv', () => ({ config: vi.fn() }));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));
vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { DatabaseBackupTarget } from '../targets/database-backup.target.js';
import { logger } from '../../../lib/logger.js';

function createMockChild() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  });
}

describe('DatabaseBackupTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgresql://raspi_app:app-password@db:5432/borrow_return');
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['', 'postgresql://raspi_migrator:owner-password@127.0.0.1:55432/codex_review'])(
    'keeps source identity and application authentication for pg_dump (restore URL=%s)', async (restoreUrl) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://codex:codex@127.0.0.1:55432/codex_review');
      vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', restoreUrl);
      const child = createMockChild();
      spawnMock.mockReturnValueOnce(child);

      queueMicrotask(() => {
        child.stdout.end('-- PostgreSQL database dump\nSELECT 1;\n');
        child.stderr.end();
        child.emit('close', 0);
      });

      const target = new DatabaseBackupTarget('postgresql://postgres:postgres@localhost:5432/borrow_return');
      expect(target.info).toEqual({ type: 'database', source: 'borrow_return' });
      const source = await target.createUploadSource();

      expect(source.kind).toBe('file');
      if (source.kind !== 'file') return;
      expect(source.filePath).toMatch(/\.sql\.gz$/);

      const compressed = await fs.readFile(source.filePath);
      expect(compressed[0]).toBe(0x1f);
      expect(compressed[1]).toBe(0x8b);
      expect(gunzipSync(compressed).toString('utf-8')).toContain('PostgreSQL database dump');

      const [, args] = spawnMock.mock.calls[0] ?? [];
      expect(args).toContain('codex_review');
      expect(args).toContain('--clean');
      expect(args).toContain('--if-exists');
      expect(args).toContain('--exclude-extension=vector');
      expect(args).toContain('--exclude-extension=pg_trgm');
      expect(args).toEqual(expect.arrayContaining(['-U', 'codex']));
      expect(args).not.toContain('--no-owner');
      expect(args).not.toContain('--no-acl');
      expect(args).not.toContain('--no-privileges');
      expect(spawnMock.mock.calls[0]?.[2].env.PGPASSWORD).toBe('codex');
      expect(args).not.toContain('-f');

      await source.cleanup?.();
      await expect(fs.stat(source.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores gzip database backups through psql stdin', async () => {
    const child = createMockChild();
    let received = '';
    child.stdin.on('data', (chunk) => {
      received += chunk.toString('utf-8');
    });
    child.stdin.on('finish', () => {
      child.emit('close', 0);
    });
    spawnMock.mockReturnValueOnce(child);

    const target = new DatabaseBackupTarget('postgresql://postgres:postgres@db:5432/borrow_return');
    const backupData = gzipSync(Buffer.from('-- PostgreSQL database dump\nSELECT 1;\n'));
    const result = await target.restore(backupData);

    expect(result.success).toBe(true);
    expect(received).toContain('PostgreSQL database dump');
    expect(spawnMock).toHaveBeenCalledWith(
      'psql',
      ['-h', 'db', '-p', '5432', '-U', 'postgres', '-d', 'borrow_return', '--no-psqlrc', '--set', 'ON_ERROR_STOP=on', '--single-transaction', '-f', '-'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    );
  });

  it.each(['development', 'test'])('uses DATABASE_URL without restore credentials in %s', async (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    const child = createMockChild();
    child.stdin.on('finish', () => child.emit('close', 0));
    spawnMock.mockReturnValueOnce(child);
    await new DatabaseBackupTarget().restore(Buffer.from('SELECT 1;'));
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-U', 'raspi_app']));
    expect(spawnMock.mock.calls[0]?.[2].env.PGPASSWORD).toBe('app-password');
  });

  it.each([undefined, '', '  '])('rejects missing production restore credentials (%s) before spawning psql', async (value) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', value);
    await expect(new DatabaseBackupTarget().restore(Buffer.from('SELECT 1;')))
      .rejects.toThrow('所有者権限の接続設定 BACKUP_RESTORE_DATABASE_URL が必要');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses only owner authentication and keeps the effective runtime destination', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', 'postgres://raspi_migrator:owner%40password@db/borrow_return?host=other&dbname=other');
    const child = createMockChild();
    child.stdin.on('finish', () => child.emit('close', 0));
    spawnMock.mockReturnValueOnce(child);
    // The historical localhost source still resolves to the runtime DATABASE_URL.
    await new DatabaseBackupTarget('postgresql://postgres:postgres@localhost:5432/borrow_return')
      .restore(Buffer.from('SELECT 1;'));
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('psql');
    expect(args).toEqual(['-h', 'db', '-p', '5432', '-U', 'raspi_migrator', '-d', 'borrow_return', '--no-psqlrc', '--set', 'ON_ERROR_STOP=on', '--single-transaction', '-f', '-', '-c',
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public."_prisma_migrations" FROM raspi_app;']);
    expect(options.env.PGPASSWORD).toBe('owner@password');
    expect(JSON.stringify(args)).not.toContain('password');
    expect(process.env.DATABASE_URL).toContain('raspi_app:app-password');
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('password');
  });

  it.each([
    'postgresql://raspi_migrator:owner-secret@other:5432/borrow_return',
    'postgresql://raspi_migrator:owner-secret@db:5433/borrow_return',
    'postgresql://raspi_migrator:owner-secret@db:5432/other',
    'https://raspi_migrator:owner-secret@db:5432/borrow_return',
    'postgresql://raspi_migrator@db:5432/borrow_return',
    'postgresql://:owner-secret@db:5432/borrow_return',
    'postgresql://raspi_migrator:%ZZ@db:5432/borrow_return',
    'postgresql://raspi_migrator:owner-secret%00password@db:5432/borrow_return',
    'postgresql://raspi%00migrator:owner-secret@db:5432/borrow_return',
    'not-a-url-owner-secret',
  ])('rejects mismatched or invalid restore settings without revealing them (%s)', async (value) => {
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', value);
    const error = await new DatabaseBackupTarget().restore(Buffer.from('SELECT 1;')).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('BACKUP_RESTORE_DATABASE_URL が不正');
    expect((error as Error).message).not.toContain('owner-secret');
    expect((error as Error).message).not.toContain(value);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects a configured target different from DATABASE_URL instead of redirecting restore', async () => {
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', 'postgresql://raspi_migrator:owner-secret@db/borrow_return');
    await expect(new DatabaseBackupTarget('other').restore(Buffer.from('SELECT 1;')))
      .rejects.toThrow('一致しません');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects nonzero psql exit and redacts owner credentials (stderr=%s)', async (withStderr) => {
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', 'postgresql://raspi_migrator:owner%40password@db/borrow_return');
    const child = createMockChild();
    child.stdin.on('finish', () => {
      if (withStderr) {
        child.stderr.write('ERROR: owner@pass');
        child.stderr.write('word owner%40password');
      }
      child.emit('close', 3);
    });
    spawnMock.mockReturnValueOnce(child);
    const error = await new DatabaseBackupTarget().restore(Buffer.from('SELECT 1;')).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Database restore failed');
    const output = JSON.stringify([String(error), vi.mocked(logger.error).mock.calls]);
    expect(output).not.toContain('owner@password');
    expect(output).not.toContain('owner%40password');
  });

  it('rejects other stdin errors and redacts owner credentials', async () => {
    const child = createMockChild();
    spawnMock.mockReturnValueOnce(child);
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', 'postgresql://raspi_migrator:owner%40password@db/borrow_return');
    queueMicrotask(() => child.stdin.emit('error', new Error('write failed owner@password owner%40password')));
    await expect(new DatabaseBackupTarget().restore(Buffer.from('SELECT 1;'))).rejects.toThrow('write failed [REDACTED] [REDACTED]');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.each([
    [3, 'NOTICE: restoring\nERROR: cannot drop table because other objects depend on it\n'],
    [1, ''],
    [null, ''],
  ])('rejects psql exit %s and retains SQL diagnostics', async (code, diagnostics) => {
    const child = createMockChild();
    spawnMock.mockReturnValueOnce(child);
    child.stdin.on('finish', () => {
      child.stderr.write(diagnostics);
      child.emit('close', code);
    });
    const target = new DatabaseBackupTarget('postgresql://postgres:postgres@db:5432/borrow_return');
    await expect(target.restore(Buffer.from('SELECT 1;'))).rejects.toThrow(
      diagnostics || 'Database restore failed'
    );
  });

  it('reports redacted SQL diagnostics after EPIPE when psql closes stdin early', async () => {
    vi.stubEnv('BACKUP_RESTORE_DATABASE_URL', 'postgresql://raspi_migrator:owner%40password@db/borrow_return');
    const child = createMockChild();
    spawnMock.mockReturnValueOnce(child);
    child.stdin.on('finish', () => {
      child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      setImmediate(() => {
        child.stderr.write('ERROR: cannot drop table owner@password owner%40password');
        child.emit('close', 3);
      });
    });
    const target = new DatabaseBackupTarget('postgresql://postgres:postgres@db:5432/borrow_return');
    await expect(target.restore(Buffer.from('SELECT 1;'))).rejects.toThrow('ERROR: cannot drop table [REDACTED] [REDACTED]');
    expect(child.kill).not.toHaveBeenCalled();
    const output = JSON.stringify(vi.mocked(logger.error).mock.calls);
    expect(output).toContain('ERROR: cannot drop table');
    expect(output).not.toContain('owner@password');
    expect(output).not.toContain('owner%40password');
  });
});
