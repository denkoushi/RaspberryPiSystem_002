import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { PassThrough } from 'stream';
import { gzipSync, gunzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

import { DatabaseBackupTarget } from '../targets/database-backup.target.js';

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('keeps the configured source identity while using the runtime connection for pg_dump', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://codex:codex@127.0.0.1:55432/codex_review');
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
      expect.arrayContaining(['-d', 'borrow_return']),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    );
  });
});
