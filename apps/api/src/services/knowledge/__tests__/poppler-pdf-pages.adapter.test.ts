import { execFile } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { PopplerPdfPagesAdapter } from '../poppler-pdf-pages.adapter.js';

vi.mock('node:child_process', () => {
  const mocked = vi.fn();
  // Match execFile's Node promisify contract (stdout + stderr), not a one-value callback.
  Object.defineProperty(mocked, Symbol.for('nodejs.util.promisify.custom'), {
    value: (...args: unknown[]) => new Promise((resolve, reject) => mocked(...args,
      (error: Error | null, stdout: string | Buffer, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }))),
  });
  return { execFile: mocked };
});

function commands(responses: (string | Buffer | Error)[]) {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: Error | null, stdout?: string | Buffer, stderr?: string) => void;
    const response = responses.shift();
    callback(response instanceof Error ? response : null, response instanceof Error ? undefined : response, '');
  }) as typeof execFile);
}

async function collect() {
  const result = [];
  for await (const page of new PopplerPdfPagesAdapter().extract(Buffer.from('%PDF-1.7'))) result.push(page);
  return result;
}

describe('Bounded Poppler PDF extraction', () => {
  it('extracts one page at a time with page numbers and bounded image dimensions', async () => {
    commands(['Pages: 2\nEncrypted: no', 'page one\f', Buffer.from('jpeg1'), 'page two', Buffer.from('jpeg2')]);
    expect(await collect()).toEqual([{ pageNumber: 1, text: 'page one', jpeg: Buffer.from('jpeg1') }, { pageNumber: 2, text: 'page two', jpeg: Buffer.from('jpeg2') }]);
    expect(vi.mocked(execFile).mock.calls.some(call => call[0] === 'pdftoppm' && (call[1] as string[]).includes('1600'))).toBe(true);
  });

  it.each([
    ['Pages: 21\nEncrypted: no', '1–20'],
    ['Pages: 2\nEncrypted: yes', 'Encrypted'],
    ['Not a PDF', '1–20'],
  ])('rejects unsupported metadata: %s', async (metadata, expected) => {
    commands([metadata]);
    await expect(collect()).rejects.toThrow(expected);
  });

  it('propagates broken/missing extractor failures instead of returning empty success', async () => {
    commands(['Pages: 1\nEncrypted: no', new Error('pdftotext unavailable')]);
    await expect(collect()).rejects.toThrow('pdftotext unavailable');
  });
});
