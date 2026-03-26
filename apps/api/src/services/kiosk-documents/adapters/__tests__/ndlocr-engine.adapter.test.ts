import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../../lib/errors.js';

const {
  execFileMock,
  mkdtempMock,
  mkdirMock,
  readdirMock,
  copyFileMock,
  readFileMock,
  rmMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  mkdtempMock: vi.fn(),
  mkdirMock: vi.fn(),
  readdirMock: vi.fn(),
  copyFileMock: vi.fn(),
  readFileMock: vi.fn(),
  rmMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('util', () => ({
  promisify:
    (fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) =>
      new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        (fn as (...a: unknown[]) => void)(...args, (err: unknown, stdout: string, stderr: string) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ stdout, stderr });
        });
      }),
}));

vi.mock('fs/promises', () => ({
  mkdtemp: mkdtempMock,
  mkdir: mkdirMock,
  readdir: readdirMock,
  copyFile: copyFileMock,
  readFile: readFileMock,
  rm: rmMock,
}));

vi.mock('../../../../lib/logger.js', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

import { NdlOcrEngineAdapter } from '../ndlocr-engine.adapter.js';

const originalEnv = { ...process.env };

describe('NdlOcrEngineAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses legacy stdout mode when enabled', async () => {
    process.env.KIOSK_DOCUMENT_OCR_LEGACY_STDOUT = 'true';

    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, 'legacy text', '');
    });

    const adapter = new NdlOcrEngineAdapter('legacy-ocr');
    const result = await adapter.runOcr('/tmp/doc.pdf');
    expect(result).toEqual({ text: 'legacy text', engine: 'NDLOCR-Lite' });
    expect(execFileMock).toHaveBeenCalledWith(
      'legacy-ocr',
      ['/tmp/doc.pdf'],
      expect.objectContaining({ timeout: 180000 }),
      expect.any(Function),
    );
  });

  it('runs default NDLOCR pipeline and merges page texts in order', async () => {
    delete process.env.KIOSK_DOCUMENT_OCR_LEGACY_STDOUT;
    process.env.KIOSK_DOCUMENT_NDLOCR_CLI = 'ndlocr-lite';

    mkdtempMock.mockResolvedValue('/tmp/kiosk-ocr-abc');
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    readdirMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/raster')) return ['page-2.png', 'page-1.png'];
      if (path.endsWith('/pages')) return ['p00002.png', 'p00001.png'];
      if (path.endsWith('/out')) return ['p00001.txt', 'p00002.txt'];
      return [];
    });
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('p00001.txt')) return 'first';
      if (path.endsWith('p00002.txt')) return 'second';
      return '';
    });
    execFileMock.mockImplementation((command, args, options, callback) => {
      if (command === 'pdftoppm') {
        expect(args).toEqual(['-png', '-r', '150', '/tmp/doc.pdf', '/tmp/kiosk-ocr-abc/raster/page']);
        callback(null, '', '');
        return;
      }
      if (command === 'ndlocr-lite') {
        expect(args[0]).toBe('--sourceimg');
        expect(args[2]).toBe('--output');
        expect(args[3]).toBe('/tmp/kiosk-ocr-abc/out');
        callback(null, '', '');
        return;
      }
      callback(new Error(`unexpected command: ${command}`), '', '');
    });

    const adapter = new NdlOcrEngineAdapter();
    const result = await adapter.runOcr('/tmp/doc.pdf');

    expect(result).toEqual({ text: 'first\n\nsecond', engine: 'NDLOCR-Lite' });
    expect(execFileMock).toHaveBeenCalledWith(
      'ndlocr-lite',
      ['--sourceimg', '/tmp/kiosk-ocr-abc/pages/p00001.png', '--output', '/tmp/kiosk-ocr-abc/out'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenCalledWith(
      'ndlocr-lite',
      ['--sourceimg', '/tmp/kiosk-ocr-abc/pages/p00002.png', '--output', '/tmp/kiosk-ocr-abc/out'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('classifies missing command as COMMAND_NOT_FOUND', async () => {
    process.env.KIOSK_DOCUMENT_OCR_LEGACY_STDOUT = 'true';

    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      const err = new Error('spawn ndlocr-lite ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      callback(err, '', '');
    });

    const adapter = new NdlOcrEngineAdapter('ndlocr-lite');
    await expect(adapter.runOcr('/tmp/doc.pdf')).rejects.toBeInstanceOf(ApiError);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'COMMAND_NOT_FOUND' }),
      '[KioskDocument] OCR legacy stdout command failed',
    );
  });
});
