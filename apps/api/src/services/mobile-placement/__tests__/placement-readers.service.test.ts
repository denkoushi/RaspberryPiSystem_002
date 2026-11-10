import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));
const mocks = vi.hoisted(() => ({ query: vi.fn(), states: vi.fn(), shelves: vi.fn(), csv: vi.fn(), filter: vi.fn(), progress: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $queryRaw: mocks.query,
  orderPlacementBranchState: { findMany: mocks.states },
  mobilePlacementShelf: { findMany: mocks.shelves },
  csvDashboardRow: { findMany: mocks.csv },
} }));
vi.mock('../placement-completion.service.js', () => ({ filterActivePlacements: mocks.filter }));
vi.mock('../mobile-placement-registered-shelves.service.js', () => ({ parseStructuredShelfCode: () => ({ isStructured: true, areaId: 'west', lineId: 'north', slot: 1 }) }));
vi.mock('../../production-schedule/seiban-progress.service.js', () => ({ fetchSeibanProgressRows: mocks.progress }));

import { suggestPartPlacementSearch } from '../part-search/part-search.service.js';
import { buildMobilePlacementPartsShelfGridViewModel } from '../../signage/mobile-placement-parts-shelf/parts-shelf-data.service.js';

const row = (id: string) => ({ id, slipKind: 'purchase_order', manufacturingOrderBarcodeRaw: id, scheduleSnapshot: { FSEIBAN: 'BA1', FHINCD: 'MD1', FHINMEI: 'shaft' },
  shelfCodeRaw: '西-北-01', csvDashboardRowId: null, branchNo: 1, fhinmei: 'shaft', fhincd: 'MD1', fseiban: 'BA1', product_no: '' });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.filter.mockImplementation(async rows => rows.filter((row: { id: string }) => !row.id.startsWith('done')));
  mocks.shelves.mockResolvedValue([]);
  mocks.progress.mockResolvedValue([]);
});
describe('shared completion filtering in shelf readers', () => {
  it('filters part-search current placements before applying its limit', async () => {
    const rows = [...Array.from({ length: 30 }, (_, id) => row(`done-${id}`)), row('active')];
    mocks.query.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    const result = await suggestPartPlacementSearch({ q: 'shaft' });
    expect(result.currentPlacements.map(row => row.branchStateId)).toEqual(['active']);
    expect(mocks.filter).toHaveBeenCalledExactlyOnceWith(rows);
    const sql = mocks.query.mock.calls[0][0].join('');
    expect(sql).toContain('"slip_kind" AS "slipKind"');
    expect(sql).toContain('"scheduleSnapshot",');
    expect(sql).not.toContain('LIMIT');
  });
  it('filters signage placements before building shelf counts', async () => {
    const rows = [row('done'), row('active')];
    mocks.states.mockResolvedValue(rows);
    const result = await buildMobilePlacementPartsShelfGridViewModel();
    expect(mocks.filter).toHaveBeenCalledExactlyOnceWith(rows);
    expect(result.zones.reduce((sum, zone) => sum + zone.totalCount, 0)).toBe(1);
    expect(mocks.csv).not.toHaveBeenCalled();
  });
});
