import { describe, expect, it, vi } from 'vitest';

import { findFkojunstMailWinnerIdsByMailTriples } from '../fkojunst-mail-winner-by-triple.reader.js';
import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';

describe('findFkojunstMailWinnerIdsByMailTriples', () => {
  it('loads winner rows once even when many triples are requested', async () => {
    const triples = [
      { fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
      { fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' },
      { fkojun: '3', fkoteicd: 'R3', fsezono: 'P3' },
    ];

    const queryRaw = vi.fn().mockResolvedValue([]);

    await findFkojunstMailWinnerIdsByMailTriples({
      client: { $queryRaw: queryRaw },
      productionScheduleDashboardId: 'dash-1',
      triples,
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('dedupes identical triples and resolves requested winner keys', async () => {
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
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(map.get(buildFkojunstMailStatusKey({ fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' }))).toBe('w1');
  });

  it('filters out winner rows that are not requested', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { id: 'a', fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
      { id: 'b', fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' },
    ]);

    const map = await findFkojunstMailWinnerIdsByMailTriples({
      client: { $queryRaw: queryRaw },
      productionScheduleDashboardId: 'dash',
      triples: [
        { fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' },
      ],
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(map.get(buildFkojunstMailStatusKey({ fkojun: '1', fkoteicd: 'R1', fsezono: 'P1' }))).toBe('a');
    expect(map.has(buildFkojunstMailStatusKey({ fkojun: '2', fkoteicd: 'R2', fsezono: 'P2' }))).toBe(false);
  });
});
