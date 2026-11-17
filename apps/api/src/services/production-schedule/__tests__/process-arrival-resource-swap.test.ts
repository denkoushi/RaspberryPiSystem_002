import { describe, expect, it, vi } from 'vitest';

import {
  buildProcessArrivalResourceSwapCompletedKeys, buildProcessArrivalResourceSwapKey,
  findProcessArrivalResourceSwapCompletedKeys
} from '../process-arrival-resource-swap.js';
import { collectFkojunstMailNormalizedRowsFromSourceRows, dedupeFkojunstMailRowsByLatest } from '../fkojunst-status-mail-sync.pipeline.js';
import type { FkojunstMailNormalizedRow } from '../fkojunst-mail-row.types.js';

const process = { productNo: '0004009125', processOrder: '205', resourceCd: '080' };
const isExcluded = (cd: string) => ['10', 'MSZ'].includes(cd.trim().toUpperCase());
const row = (resourceCd: string, statusCode = 'C', date = '2026-11-16T00:00:00Z',
  overrides: Partial<FkojunstMailNormalizedRow> = {}): FkojunstMailNormalizedRow => ({
  sourceRowId: resourceCd, fsezono: process.productNo, fkojun: '205', fkoteicd: resourceCd,
  statusCode, sourceUpdatedAt: new Date(date), hasUnparseableDate: false, ...overrides
});
const completed = (rows: FkojunstMailNormalizedRow[]) =>
  buildProcessArrivalResourceSwapCompletedKeys(rows, [process], isExcluded);

describe('process arrival resource swap', () => {
  it('treats 0004009125 205/080 R on 8/20 as complete after 205/035 C on 11/16', () => {
    expect(completed([row('080', 'R', '2026-08-20T00:00:00Z'), row('035')]))
      .toEqual(new Set([buildProcessArrivalResourceSwapKey(process)]));
  });

  it.each(['X', 'R', 'S', 'P', 'O', '?', ''])('ignores another resource with status %j', (status) => {
    expect(completed([row('035', status)]).size).toBe(0);
  });

  it.each(['10', 'MSZ'])('ignores an excluded completed resource %s', (cd) => {
    expect(completed([row(cd)]).size).toBe(0);
  });

  it('ignores excluded schedule resources', () => {
    expect(buildProcessArrivalResourceSwapCompletedKeys([row('035')], [{ ...process, resourceCd: 'MSZ' }], isExcluded).size).toBe(0);
  });

  it('does not override own S even when the other completion is newer', () => {
    expect(completed([row('080', 'S', '2026-08-20T00:00:00Z'), row('035')]).size).toBe(0);
  });

  it('does not override a newer own status', () => {
    expect(completed([row('080', 'R', '2026-11-17T00:00:00Z'), row('035')]).size).toBe(0);
  });

  it('accepts equal timestamps', () => {
    expect(completed([row('080', 'R'), row('035')]).size).toBe(1);
  });

  it('accepts completion when there is no own raw row', () => {
    expect(completed([row('035')]).size).toBe(1);
  });

  it('isolates ProductNo and process order', () => {
    expect(completed([row('035', 'C', undefined, { fsezono: 'OTHER' }), row('035', 'C', undefined, { fkojun: '200' })]).size).toBe(0);
  });

  it('does not use own resource C as swap evidence', () => {
    expect(completed([row('080')]).size).toBe(0);
  });

  it.each(['own', 'other'])('rejects unparseable dates on %s', (side) => {
    expect(completed([
      row('080', 'R', undefined, { hasUnparseableDate: side === 'own' }),
      row('035', 'C', undefined, { hasUnparseableDate: side === 'other' })
    ]).size).toBe(0);
  });

  it('trims keys and compares resource codes in uppercase', () => {
    const target = { productNo: ' 0004009125 ', processOrder: ' 205 ', resourceCd: ' abc ' };
    expect(buildProcessArrivalResourceSwapCompletedKeys([row('ABC')], [target], isExcluded).size).toBe(0);
    expect(buildProcessArrivalResourceSwapCompletedKeys([row('035')], [target], isExcluded))
      .toEqual(new Set([buildProcessArrivalResourceSwapKey(target)]));
  });

  it('uses the latest state per triple and keeps the first state at equal timestamps', () => {
    const rows = dedupeFkojunstMailRowsByLatest([
      row('035', 'C', '2026-08-20T00:00:00Z'), row('035', 'R'), row('035', 'C')
    ]);
    expect(completed(rows).size).toBe(0);
  });

  it('retains an unparseable latest generation instead of using stale completion', () => {
    const { normalizedRows } = collectFkojunstMailNormalizedRowsFromSourceRows([
      { id: 'old', rowData: { FSEZONO: process.productNo, FKOJUN: '205', FKOTEICD: '035', FKOJUNST: 'C', FUPDTEDT: '11/16/2026 15:04:00' },
        sourceRowOrdinal: 0, sourceIngestRunCompletedAt: new Date('2026-11-16T00:00:00Z') },
      { id: 'new', rowData: { FSEZONO: process.productNo, FKOJUN: '205', FKOTEICD: '035', FKOJUNST: 'C', FUPDTEDT: 'invalid' },
        sourceRowOrdinal: 1, sourceIngestRunCompletedAt: new Date('2026-11-17T00:00:00Z') }
    ]);
    expect(completed(dedupeFkojunstMailRowsByLatest(normalizedRows)).size).toBe(0);
  });
});

describe('resource swap source reader', () => {
  it('does not read raw rows without target ProductNos', async () => {
    const $queryRaw = vi.fn();
    expect(await findProcessArrivalResourceSwapCompletedKeys([], isExcluded, { $queryRaw })).toEqual(new Set());
    expect($queryRaw).not.toHaveBeenCalled();
  });

  it('uses a literal dashboard predicate, ordered source rows and mail normalization', async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{
      id: 'raw', rowData: { FSEZONO: ' 0004009125 ', FKOJUN: ' 205 ', FKOTEICD: ' abc ', FKOJUNST: ' c ', FUPDTEDT: '11/16/2026 15:04:00' }
    }]);
    expect(await findProcessArrivalResourceSwapCompletedKeys([process, process], isExcluded, { $queryRaw }))
      .toEqual(new Set([buildProcessArrivalResourceSwapKey(process)]));
    const sql = $queryRaw.mock.calls[0]![0];
    expect(sql.values).toEqual([['0004009125']]);
    const query = sql.strings.join('?');
    expect(query).toContain(`r."csvDashboardId" = 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e'`);
    expect(query).toContain(`BTRIM(r."rowData"->>'FSEZONO') = ANY(?::text[])`);
    expect(query).toContain('ORDER BY ir."completedAt" ASC, r."sourceIngestRunStartedAt" ASC, r."sourceRowOrdinal" ASC, r."createdAt" ASC, r."id" ASC');
    expect(query).toContain('ir."completedAt" AS "sourceIngestRunCompletedAt"');
  });

  it('propagates source read failures', async () => {
    const error = new Error('read failed');
    const $queryRaw = vi.fn().mockRejectedValue(error);
    await expect(findProcessArrivalResourceSwapCompletedKeys([process], isExcluded, { $queryRaw })).rejects.toBe(error);
  });
});
