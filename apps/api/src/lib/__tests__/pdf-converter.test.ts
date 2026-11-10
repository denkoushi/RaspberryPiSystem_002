import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    execFileMock(file, args, options);
    callback(null, '', '');
  }
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

import { convertPdfToImages, PDF_CONVERT_DEFAULT_TIMEOUT_MS } from '../pdf-converter.js';

describe('convertPdfToImages', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    execFileMock.mockReset();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('applies the default timeout and converts every page when no limit is given', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-converter-test-'));
    await convertPdfToImages('/tmp/in.pdf', tempDir, { prefix: 'page' });

    const [file, args, options] = execFileMock.mock.calls[0];
    expect(file).toBe('pdftoppm');
    expect(args).not.toContain('-l');
    expect(options).toEqual({ timeout: PDF_CONVERT_DEFAULT_TIMEOUT_MS });
  });

  it('passes the last page and timeout to pdftoppm', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-converter-test-'));
    await convertPdfToImages('/tmp/in.pdf', tempDir, { prefix: 'page', lastPage: 41, timeoutMs: 120_000 });

    const [, args, options] = execFileMock.mock.calls[0];
    expect(args).toEqual(['-jpeg', '-r', '144', '-jpegopt', 'quality=85', '-l', '41', '/tmp/in.pdf', path.join(tempDir, 'page')]);
    expect(options).toEqual({ timeout: 120_000 });
  });
});
