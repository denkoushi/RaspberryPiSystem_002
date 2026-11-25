import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), winners: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleSessakuPiece: { findMany: mocks.findMany } } }));
vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByLogicalKeyFseibans: mocks.winners }));
import { discoverSourceRows } from '../grinding-planning-board/write-source.js';
import { decodeRowItemId } from '../grinding-planning-board/shared.js';
import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';

const rowData = (fkojun: string) => ({ FSEIBAN: 'S1', FHINCD: 'PART', FSIGENCD: 'G1', FKOJUN: fkojun, ProductNo: '1' });
const pieceSet = (fkojun: string) => ({ fseiban: 'S1', fhincd: 'PART', fsigencd: 'G1', fkojun, productNo: '1' });

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

  describe('two live ProductNos on one 4-column key', () => {
    const twoOrders = (productNo: string, fkojun = '10') => ({ ...rowData(fkojun), ProductNo: productNo });
    const legacyItemId = (fkojun: string) =>
      `row:${Buffer.from(JSON.stringify(['S1', 'PART', 'G1', fkojun])).toString('base64url')}`;

    beforeEach(() => {
      mocks.winners.mockResolvedValue([
        { id: 'o-a', rowData: twoOrders('0004146538') }, { id: 'o-b', rowData: twoOrders('0004146555') }
      ]);
    });

    it('builds a 5-element item id and decodes it back for every seiban', () => {
      const a = buildGrindingPlanningBoardRowItemId(twoOrders('0004146538'));
      const b = buildGrindingPlanningBoardRowItemId(twoOrders('0004146555'));
      expect(a).not.toBe(b);
      expect(JSON.parse(decodeRowItemId(a)!)).toEqual(['S1', 'PART', 'G1', '10', '0004146538']);
      expect(JSON.parse(decodeRowItemId(b)!)).toEqual(['S1', 'PART', 'G1', '10', '0004146555']);
      const masked = buildGrindingPlanningBoardRowItemId({ ...twoOrders('0004146538'), FSEIBAN: '********' });
      expect(JSON.parse(decodeRowItemId(masked)!)).toHaveLength(5);
    });

    it('still reads a stored 4-element id, and rejects other lengths', () => {
      expect(JSON.parse(decodeRowItemId(legacyItemId('10'))!)).toEqual(['S1', 'PART', 'G1', '10']);
      expect(decodeRowItemId(`row:${Buffer.from(JSON.stringify(['S1', 'PART', 'G1'])).toString('base64url')}`)).toBeNull();
    });

    it('resolves each 5-element id to its own order row', async () => {
      const a = buildGrindingPlanningBoardRowItemId(twoOrders('0004146538'));
      const b = buildGrindingPlanningBoardRowItemId(twoOrders('0004146555'));
      expect([...(await discoverSourceRows([a, b]))]).toEqual([[a, 'o-a'], [b, 'o-b']]);
    });

    it('refuses a 4-element id even when only one order is visible', async () => {
      await expect(discoverSourceRows([legacyItemId('10')])).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_ITEM' });
      mocks.winners.mockResolvedValue([{ id: 'only', rowData: twoOrders('0004146538') }]);
      await expect(discoverSourceRows([legacyItemId('10')])).rejects.toMatchObject({ statusCode: 409, code: 'STALE_PLANNING_BOARD_ITEM' });
    });
  });
});
