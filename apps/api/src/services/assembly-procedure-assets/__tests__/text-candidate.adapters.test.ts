import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { CoordinateOcrTextCandidateAdapter } from '../coordinate-ocr-text-candidate.adapter.js';
import { CompositeTextCandidateAdapter } from '../composite-text-candidate.adapter.js';
import {
  PopplerBboxLayoutTextCandidateAdapter,
  PopplerTextCandidateAdapter,
} from '../poppler-text-candidate.adapter.js';

describe('assembly procedure text candidate adapters', () => {
  it('maps coordinate OCR words to normalized bounds', async () => {
    const image = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer();
    const adapter = new CoordinateOcrTextCandidateAdapter({
      runLayoutOcrOnImage: vi.fn(async () => ({
        text: 'M8',
        engine: 'test',
        words: [{ text: ' M8 ', confidence: 0.9, bbox: { x0: 20, y0: 10, x1: 80, y1: 30 } }],
      })),
    });
    await expect(adapter.extractCandidates({ imageBytes: image })).resolves.toEqual([
      {
        text: 'M8',
        confidence: 0.9,
        bounds: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.2 },
        pageIndex: null,
        source: 'coordinate-ocr',
      },
    ]);
  });

  it('returns text-only Poppler candidates and falls back to empty on failure', async () => {
    const adapter = new PopplerTextCandidateAdapter({
      extractText: vi.fn(async () => ({ text: 'first line\n\nsecond line' })),
    });
    await expect(adapter.extractCandidates({ pdfPath: '/tmp/input.pdf', pageIndex: 2 })).resolves.toEqual([
      {
        text: 'first line',
        confidence: null,
        bounds: null,
        pageIndex: 2,
        source: 'poppler',
      },
      {
        text: 'second line',
        confidence: null,
        bounds: null,
        pageIndex: 2,
        source: 'poppler',
      },
    ]);
    const failed = new PopplerTextCandidateAdapter({
      extractText: vi.fn(async () => {
        throw new Error('pdftotext unavailable');
      }),
    });
    await expect(failed.extractCandidates({ pdfPath: '/tmp/input.pdf' })).resolves.toEqual([]);
  });

  it('runs bbox-layout for one page and maps intersecting words to ROI-local bounds', async () => {
    const runCommand = vi.fn(async () => ({
      stdout: `<?xml version="1.0"?><page width="600" height="800">
        <word xMin="60" yMin="80" xMax="180" yMax="160">A&amp;B</word>
        <word xMin="520" yMin="80" xMax="560" yMax="120">outside</word>
      </page>`,
    }));
    const adapter = new PopplerBboxLayoutTextCandidateAdapter({
      timeoutMs: 1_234,
      maxOutputBytes: 4_096,
      runCommand,
    });

    await expect(
      adapter.extractCandidates({
        pdfPath: '/tmp/immutable-source.pdf',
        pageIndex: 2,
        roi: { xRatio: 0.05, yRatio: 0.05, widthRatio: 0.5, heightRatio: 0.5 },
      }),
    ).resolves.toEqual([
      {
        text: 'A&B',
        confidence: null,
        bounds: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.2 },
        pageIndex: 2,
        source: 'poppler',
      },
    ]);
    expect(runCommand).toHaveBeenCalledWith(
      'pdftotext',
      ['-bbox-layout', '-f', '3', '-l', '3', '/tmp/immutable-source.pdf', '-'],
      { timeout: 1_234, maxBuffer: 4_096 },
    );
  });

  it('returns an empty list for command errors or output beyond the configured limit', async () => {
    const failed = new PopplerBboxLayoutTextCandidateAdapter({
      runCommand: vi.fn(async () => {
        throw new Error('pdftotext unavailable');
      }),
    });
    await expect(failed.extractCandidates({ pdfPath: '/tmp/input.pdf', pageIndex: 0 })).resolves.toEqual([]);

    const oversized = new PopplerBboxLayoutTextCandidateAdapter({
      maxOutputBytes: 8,
      runCommand: vi.fn(async () => ({ stdout: '123456789' })),
    });
    await expect(oversized.extractCandidates({ pdfPath: '/tmp/input.pdf', pageIndex: 0 })).resolves.toEqual([]);
  });

  it('uses Poppler first for PDF input and OCR only when Poppler has no result', async () => {
    const candidate = {
      text: 'PDF text',
      confidence: null,
      bounds: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.1 },
      pageIndex: 0,
      source: 'poppler' as const,
    };
    const poppler = { extractCandidates: vi.fn(async () => [candidate]) };
    const coordinate = {
      extractCandidates: vi.fn(async () => []),
    };
    const composite = new CompositeTextCandidateAdapter(coordinate, poppler);

    await expect(composite.extractCandidates({ pdfPath: '/tmp/input.pdf', pageIndex: 0 })).resolves.toEqual([
      candidate,
    ]);
    expect(poppler.extractCandidates).toHaveBeenCalledTimes(1);
    expect(coordinate.extractCandidates).not.toHaveBeenCalled();

    poppler.extractCandidates.mockResolvedValueOnce([]);
    const ocrCandidate = { ...candidate, source: 'coordinate-ocr' as const };
    coordinate.extractCandidates.mockResolvedValueOnce([ocrCandidate]);
    await expect(composite.extractCandidates({ pdfPath: '/tmp/input.pdf', pageIndex: 0 })).resolves.toEqual([
      ocrCandidate,
    ]);
    expect(coordinate.extractCandidates).toHaveBeenCalledTimes(1);

    coordinate.extractCandidates.mockResolvedValue([ocrCandidate]);
    await expect(composite.extractCandidates({ imageBytes: Buffer.from('image') })).resolves.toEqual([
      ocrCandidate,
    ]);
    expect(poppler.extractCandidates).toHaveBeenCalledTimes(2);
  });
});
