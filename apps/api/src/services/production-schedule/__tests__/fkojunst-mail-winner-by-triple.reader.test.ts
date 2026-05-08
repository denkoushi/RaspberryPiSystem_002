import { describe, expect, it, vi } from 'vitest';

import { POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS } from '../../../lib/postgres-prepared-statement-bind-limit.js';
import {
  defaultFkojunstMailWinnerTripleChunkSize,
  findFkojunstMailWinnerIdsByMailTriples,
} from '../fkojunst-mail-winner-by-triple.reader.js';
import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';

describe('findFkojunstMailWinnerIdsByMailTriples', () => {
  it('runs multiple $queryRaw rounds when triples exceed chunkSize', async () => {
    const dashboardId = 'dash-1';
    const chunkSize = 2;
    const triples = [
      { fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
      { fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' },
      { fkojun: '3', fkoteicd: 'R3', fsezono: 'P3' },
    ];

    const queryRaw = vi.fn().mockResolvedValue([]);

    await findFkojunstMailWinnerIdsByMailTriples({
      client: { $queryRaw: queryRaw },
      productionScheduleDashboardId: dashboardId,
      triples,
      chunkSize,
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('dedupes identical triples and still resolves one chunk', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'w1',
        fkojun: '1',
        fkoteicd: 'R1',
        fsezono: 'P1',
      },
    ]);

    const map = await findFkojunstMailWinnerIdsByMailTriples({
      client: { $queryRaw: queryRaw },
      productionScheduleDashboardId: 'dash',
      triples: [
        { fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
        { fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
      ],
      chunkSize: 10,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(map.get(buildFkojunstMailStatusKey({ fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' }))).toBe('w1');
  });

  it('default chunk size keeps per-query tuple binds under PG limit', () => {
    const chunk = defaultFkojunstMailWinnerTripleChunkSize();
    const bindsPerTuple = 3;
    const fixedReserve = 65;
    expect(chunk * bindsPerTuple + fixedReserve).toBeLessThanOrEqual(POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS);
    expect(chunk).toBeLessThanOrEqual(1000);
    expect(chunk).toBeGreaterThan(0);
  });

  it('merges winner maps from consecutive chunks', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 'a', fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
      ])
      .mockResolvedValueOnce([
        { id: 'b', fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' },
      ]);

    const map = await findFkojunstMailWinnerIdsByMailTriples({
      client: { $queryRaw: queryRaw },
      productionScheduleDashboardId: 'dash',
      triples: [
        { fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
        { fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' },
      ],
      chunkSize: 1,
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(map.get(buildFkojunstMailStatusKey({ fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' }))).toBe('a');
    expect(map.get(buildFkojunstMailStatusKey({ fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' }))).toBe('b');
  });
});
