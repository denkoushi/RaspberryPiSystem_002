import { describe, expect, it, vi } from 'vitest';

import type { PdfPagesPort } from '../../knowledge/pdf-pages.port.js';
import { normalizeProcedureMaterialPdfText, ProcedureMaterialPdfTextService } from '../procedure-material-pdf-text.service.js';

type Material = { id: string; kind: 'PDF' | 'PHOTO' | 'TEXT'; text: string | null; storageKey: string | null; gmailDedupeKey: string; discardedAt: Date | null; receivedAt: Date; createdAt: Date };
const material = (id: string, overrides: Partial<Material> = {}): Material => ({
  id, kind: 'PDF', text: null, storageKey: `procedure-materials/${id}/original`, gmailDedupeKey: `gmail:${id}`,
  discardedAt: null, receivedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), ...overrides,
});
const page = (id: string, pageNumber: number, overrides: Partial<Material> = {}) => material(`${id}:p${pageNumber}`, { kind: 'PHOTO', gmailDedupeKey: `gmail:${id}:p${pageNumber}`, ...overrides });
function harness(rows: Material[], texts = [' 第一頁\0 ', '第二頁'], pdfPages?: PdfPagesPort) {
  const matches = (row: Material, where: Partial<Record<keyof Material, unknown>>) => Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' ? row[key as keyof Material] !== (value as { not: unknown }).not : row[key as keyof Material] === value);
  const db = { procedureMaterial: {
    findMany: vi.fn(async ({ where, take }: { where: Partial<Record<keyof Material, unknown>>; take: number }) => rows.filter((row) => matches(row, where))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, take)),
    updateMany: vi.fn(async ({ where, data }: { where: Partial<Record<keyof Material, unknown>>; data: Partial<Material> }) => {
      const selected = rows.filter((row) => matches(row, where));
      selected.forEach((row) => Object.assign(row, data));
      return { count: selected.length };
    }),
  }, $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
    const snapshot = rows.map((row) => ({ ...row }));
    try { return await work(db); }
    catch (error) { rows.forEach((row, index) => Object.assign(row, snapshot[index])); throw error; }
  }) };
  const store = { read: vi.fn(async (key: string) => Buffer.from(key)) };
  const extract = vi.fn(async function* () {
    for (const [index, text] of texts.entries()) yield { pageNumber: index + 1, text, jpeg: Buffer.alloc(0) };
  });
  return { rows, db, store, extract, service: new ProcedureMaterialPdfTextService(db as never, store as never, pdfPages ?? { extract }) };
}

describe('procedure-material PDF text backfill', () => {
  it('dry runs the oldest eligible PDFs with counts only and no database writes', async () => {
    const rows = [material('new', { receivedAt: new Date('2026-10-02') }), material('old'), material('discarded', { discardedAt: new Date() }),
      material('done', { text: '既存' }), material('scan-done', { text: '' }), material('no-file', { storageKey: null }), page('old', 1)];
    const h = harness(rows);
    const before = rows.map((row) => ({ ...row }));
    expect(await h.service.backfill({ limit: 1 })).toEqual({ dryRun: true, candidates: 1, updated: 0, withoutText: 0, failed: 0 });
    expect(h.store.read).toHaveBeenCalledExactlyOnceWith('procedure-materials/old/original', { verifyIntegrity: true });
    expect(h.db.procedureMaterial.findMany).toHaveBeenCalledWith({
      where: { kind: 'PDF', text: null, discardedAt: null, storageKey: { not: null } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: 1,
      select: { id: true, storageKey: true, gmailDedupeKey: true },
    });
    expect(rows).toEqual(before); expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.db.procedureMaterial.updateMany).not.toHaveBeenCalled();
  });
  it('writes PDF and matching page text once, preserving discarded, populated and unrelated rows', async () => {
    const rows = [material('pdf'), page('pdf', 1), page('pdf', 2), page('pdf', 3, { text: '既存' }), page('pdf', 4, { discardedAt: new Date() }),
      page('other', 1), material('wrong-kind', { kind: 'TEXT', gmailDedupeKey: 'gmail:pdf:p5' }), material('done', { text: '既存PDF' }), material('discarded', { discardedAt: new Date() })];
    const h = harness(rows, [' 第一頁\0 ', '第二頁', '第三頁', '第四頁', '第五頁']);
    const untouched = rows.slice(3).map((row) => ({ ...row }));
    expect(await h.service.backfill({ dryRun: false })).toEqual({ dryRun: false, candidates: 1, updated: 1, withoutText: 0, failed: 0 });
    expect(rows.slice(0, 3).map((row) => row.text)).toEqual(['第一頁\n第二頁\n第三頁\n第四頁\n第五頁', '第一頁', '第二頁']);
    expect(rows.slice(3)).toEqual(untouched);
    expect(await h.service.backfill({ dryRun: false })).toEqual({ dryRun: false, candidates: 0, updated: 0, withoutText: 0, failed: 0 });
    expect(h.store.read).toHaveBeenCalledTimes(1);
  });
  it('marks a textless PDF as examined only on execution and keeps blank pages null', async () => {
    const rows = [material('scan'), page('scan', 1)];
    const h = harness(rows, [' \n\t\0 ']);
    expect(await h.service.backfill()).toEqual({ dryRun: true, candidates: 1, updated: 0, withoutText: 1, failed: 0 });
    expect(rows.map((row) => row.text)).toEqual([null, null]);
    expect(await h.service.backfill({ dryRun: false })).toEqual({ dryRun: false, candidates: 1, updated: 0, withoutText: 1, failed: 0 });
    expect(rows.map((row) => row.text)).toEqual(['', null]);
    expect((await h.service.backfill({ dryRun: false })).candidates).toBe(0);
  });
  it.each([true, false])('continues after read and extraction failures without partial writes (dryRun: %s)', async (dryRun) => {
    const rows = [material('a-read-failed'), material('b-extract-failed'), material('c-ok'), page('b-extract-failed', 1), page('c-ok', 1)];
    const h = harness(rows, [], { extract: async function* (bytes) {
      yield { pageNumber: 1, text: '手順', jpeg: Buffer.alloc(0) };
      if (bytes.toString().includes('b-extract-failed')) throw new Error('extraction failed');
    } });
    h.store.read.mockRejectedValueOnce(new Error('missing original'));
    expect(await h.service.backfill({ dryRun })).toEqual({ dryRun, candidates: 3, updated: dryRun ? 0 : 1, withoutText: 0, failed: 2 });
    expect(rows.slice(0, 2).map((row) => row.text)).toEqual([null, null]); expect(rows[3].text).toBeNull();
    expect(rows[2].text).toBe(dryRun ? null : '手順'); expect(rows[4].text).toBe(dryRun ? null : '手順');
  });
  it('rolls back a PDF if its page update fails and continues to the next PDF', async () => {
    const h = harness([material('a'), page('a', 1), material('b'), page('b', 1)], ['手順']);
    const update = h.db.procedureMaterial.updateMany.getMockImplementation()!;
    h.db.procedureMaterial.updateMany.mockImplementationOnce(update).mockRejectedValueOnce(new Error('page write failed'));
    expect(await h.service.backfill({ dryRun: false })).toEqual({ dryRun: false, candidates: 2, updated: 1, withoutText: 0, failed: 1 });
    expect(h.rows.map((row) => row.text)).toEqual([null, null, '手順', '手順']);
  });
  it.each(['discarded', 'populated'])('does not write a PDF or its pages if it becomes %s after selection', async (state) => {
    const h = harness([material('pdf'), page('pdf', 1)], ['手順']);
    h.store.read.mockImplementationOnce(async () => {
      if (state === 'discarded') h.rows[0].discardedAt = new Date(); else h.rows[0].text = '別処理の文字';
      return Buffer.from('pdf');
    });
    expect((await h.service.backfill({ dryRun: false })).updated).toBe(0);
    expect(h.rows[0].text).toBe(state === 'populated' ? '別処理の文字' : null); expect(h.rows[1].text).toBeNull();
  });
  it('applies the ingestion text limits in page order without invalid Unicode', async () => {
    const h = harness([material('pdf'), page('pdf', 1)], [], { extract: async function* () {
      for (const pageNumber of [2, 1, 3, 4, 5, 6]) yield { pageNumber, text: String(pageNumber).repeat(4001), jpeg: Buffer.alloc(0) };
    } });
    expect((await h.service.backfill({ dryRun: false })).updated).toBe(1);
    expect(h.rows[0].text).toBe([1, 2, 3, 4, 5, 6].map((n) => String(n).repeat(4000)).join('\n').slice(0, 20000));
    expect(h.rows[1].text).toBe('1'.repeat(4000));
    expect(normalizeProcedureMaterialPdfText('\uD800\0😀\uDC00', 1)).toBe('😀');
  });
  it.each([0, 26])('does not mark extraction yielding %i pages as examined', async (count) => {
    const h = harness([material('pdf')], [], { extract: async function* () {
      for (let pageNumber = 1; pageNumber <= count; pageNumber++) yield { pageNumber, text: '手順', jpeg: Buffer.alloc(0) };
    } });
    expect(await h.service.backfill({ dryRun: false })).toEqual({ dryRun: false, candidates: 1, updated: 0, withoutText: 0, failed: 1 });
    expect(h.rows[0].text).toBeNull(); expect(h.db.$transaction).not.toHaveBeenCalled();
  });
});
