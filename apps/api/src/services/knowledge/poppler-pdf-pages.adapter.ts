import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { PdfPagesPort } from './pdf-pages.port.js';

const execute = promisify(execFile);

/** Reuses the system's Poppler tools. Unlike kiosk import, extraction failures remain explicit. */
export class PopplerPdfPagesAdapter implements PdfPagesPort {
  async *extract(pdf: Buffer, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-pdf-'));
    const input = path.join(directory, 'original.pdf');
    const options = { timeout: 30_000, signal, env: { ...process.env, LC_ALL: 'C' } };
    try {
      await writeFile(input, pdf, { mode: 0o600 });
      const info = await execute('pdfinfo', [input], { ...options, maxBuffer: 64_000 });
      if (/^Encrypted:\s+yes/m.test(info.stdout)) throw new Error('Encrypted PDFs are not supported');
      const pages = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isInteger(pages) || pages < 1 || pages > 20) throw new Error('Pilot PDF must contain 1–20 pages');
      for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
        signal?.throwIfAborted();
        const page = String(pageNumber);
        const text = await execute('pdftotext', ['-f', page, '-l', page, '-layout', input, '-'], { ...options, maxBuffer: 100_000 });
        const image = await execute('pdftoppm', ['-f', page, '-l', page, '-singlefile', '-scale-to', '1600', '-jpeg', input], { ...options, encoding: 'buffer', maxBuffer: 8_000_000 });
        yield { pageNumber, text: text.stdout.replace(/\f/g, '').trim(), jpeg: image.stdout };
      }
    } finally {
      // This unique temporary directory is owned exclusively by this extraction attempt.
      await rm(directory, { recursive: true, force: true });
    }
  }
}
