import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), resolve: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { orderPlacementBranchState: { findMany: mocks.findMany } } }));
vi.mock('../../production-schedule/seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesBatched: mocks.resolve }));

import { HAIZEN_OVERVIEW_LIMIT, listHaizenOverview } from '../haizen-overview.service.js';

const row = { id: 'branch-1', branchNo: 1, manufacturingOrderBarcodeRaw: '123', shelfCodeRaw: '西-北-01', updatedAt: new Date('2026-10-22T00:00:00Z'), scheduleSnapshot: { FSEIBAN: ' BA1S2320 ', FHINCD: 'K0381', FHINMEI: '部品' } };

beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue({ machineNames: { BA1S2320: 'ＲＶ－１２Ａ' } }); });
describe('haizen overview', () => {
  it('returns each current branch with snapshot fields and batched machine names', async () => {
    mocks.findMany.mockResolvedValue([row, { ...row, id: 'branch-2', branchNo: 2, shelfCodeRaw: '東-南-02' }]);
    const result = await listHaizenOverview();
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ fseiban: 'BA1S2320', fhincd: 'K0381', fhinmei: '部品', machineName: 'ＲＶ－１２Ａ', updatedAt: '2026-10-22T00:00:00.000Z' });
    expect(result.rows[1]).toMatchObject({ branchNo: 2, shelfCodeRaw: '東-南-02' });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledWith(['BA1S2320', 'BA1S2320']);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3001, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }));
  });
  it('tolerates missing and malformed snapshot values', async () => {
    mocks.findMany.mockResolvedValue([null, [], 'invalid', { FSEIBAN: 42, FHINCD: ' ', FHINMEI: {} }].map((scheduleSnapshot, id) => ({ ...row, id: String(id), scheduleSnapshot })));
    const result = await listHaizenOverview();
    expect(result.rows.every(value => value.fseiban === null && value.fhincd === null && value.fhinmei === null && value.machineName === null)).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledWith([]);
  });
  it.each([HAIZEN_OVERVIEW_LIMIT, HAIZEN_OVERVIEW_LIMIT + 1])('caps %i rows and reports actual truncation', async count => {
    mocks.findMany.mockResolvedValue(Array.from({ length: count }, (_, id) => ({ ...row, id: String(id) })));
    const result = await listHaizenOverview();
    expect(result.rows).toHaveLength(HAIZEN_OVERVIEW_LIMIT);
    expect(result.truncated).toBe(count > HAIZEN_OVERVIEW_LIMIT);
  });
  it('handles no current branches', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await listHaizenOverview()).toEqual({ rows: [], truncated: false });
  });
});
