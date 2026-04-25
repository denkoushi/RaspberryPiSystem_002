import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PalletVisualizationBoardDataSource } from '../pallet-visualization-board-data-source.js';

const { queryBoardMock } = vi.hoisted(() => ({ queryBoardMock: vi.fn() }));

vi.mock('../../../../pallet-visualization/pallet-visualization-query.service.js', () => ({
  queryPalletVisualizationBoard: queryBoardMock,
}));

describe('PalletVisualizationBoardDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps board items to pallet_board lines', async () => {
    queryBoardMock.mockResolvedValue({
      machines: [
        {
          machineCd: 'MC01',
          machineName: '機A',
          illustrationUrl: null,
          pallets: [
            {
              palletNo: 1,
              items: [
                {
                  id: 'i1',
                  machineCd: 'MC01',
                  palletNo: 1,
                  displayOrder: 1,
                  fhincd: 'P1',
                  fhinmei: '部品',
                  fseiban: 'S1',
                  machineName: '機種X',
                  machineNameDisplay: '機種X',
                  csvDashboardRowId: null,
                  plannedStartDateDisplay: null,
                  plannedQuantity: null,
                  outsideDimensionsDisplay: null,
                },
              ],
            },
          ],
        },
      ],
    });

    const source = new PalletVisualizationBoardDataSource();
    const result = await source.fetchData({});

    expect(result.kind).toBe('pallet_board');
    if (result.kind === 'pallet_board') {
      expect(result.machines).toHaveLength(1);
      const p1 = result.machines[0]?.pallets.find((p) => p.palletNo === 1);
      expect(p1?.lines[0]).toContain('P1');
      expect(p1?.lines[0]).toContain('部品');
      expect(p1?.lines[0]).toContain('S1');
      expect(p1?.lines[0]).toContain('機種X');
      expect(p1?.isEmpty).toBe(false);
      expect(p1?.primaryItem?.fhincd).toBe('P1');
    }
    expect(queryBoardMock).toHaveBeenCalledWith(undefined);
  });

  it('passes machineCds filter to queryPalletVisualizationBoard', async () => {
    queryBoardMock.mockResolvedValue({ machines: [] });
    const source = new PalletVisualizationBoardDataSource();
    await source.fetchData({ machineCds: ['mc01', ' mc02 '] });
    expect(queryBoardMock).toHaveBeenCalledWith({ machineCds: ['MC01', 'MC02'] });
  });
});
