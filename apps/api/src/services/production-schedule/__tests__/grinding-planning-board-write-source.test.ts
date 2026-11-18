import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), winners: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleSessakuPiece: { findMany: mocks.findMany } } }));
vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByLogicalKeyFseibans: mocks.winners }));
import { discoverSourceRows } from '../grinding-planning-board/write-source.js';

const rowData = (fkojun: string) => ({ FSEIBAN: 'S1', FHINCD: 'PART', FSIGENCD: 'G1', FKOJUN: fkojun, ProductNo: '1' });
const pieceSet = (fkojun: string) => ({ fseiban: 'S1', fhincd: 'PART', fsigencd: 'G1', fkojun });

describe('discoverSourceRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.winners.mockResolvedValue([{ id: 'r10', rowData: rowData('10') }, { id: 'r20', rowData: rowData('20') }]);
  });

  it('resolves every piece item with one lookup', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'a', pieceSet: pieceSet('10') }, { id: 'b', pieceSet: pieceSet('10') }, { id: 'c', pieceSet: pieceSet('20') }
    ]);
    const result = await discoverSourceRows(['piece:a', 'pieceops:b:2', 'piece:c']);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect([...result]).toEqual([['piece:a', 'r10'], ['pieceops:b:2', 'r10'], ['piece:c', 'r20']]);
  });

  it('falls back to per-item lookups and keeps the first error when a piece is gone', async () => {
    mocks.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.filter((id) => id !== 'gone').map((id) => ({ id, pieceSet: pieceSet('10') })));
    await expect(discoverSourceRows(['piece:a', 'piece:gone', 'piece:c'])).rejects.toMatchObject({ code: 'STALE_SESSAKU_PIECES' });
    expect(mocks.findMany).toHaveBeenCalledTimes(3);
  });
});
