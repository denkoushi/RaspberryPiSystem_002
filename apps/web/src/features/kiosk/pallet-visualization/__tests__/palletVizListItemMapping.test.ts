import { describe, expect, it } from 'vitest';

import { mapPalletVisualizationDtoToListItem } from '../palletVizListItemMapping';

import type { PalletVisualizationItemDto } from '../../../../api/client';

describe('mapPalletVisualizationDtoToListItem', () => {
  it('maps extended DTO fields', () => {
    const dto: PalletVisualizationItemDto = {
      id: 'x',
      machineCd: 'M1',
      palletNo: 2,
      displayOrder: 1,
      fhincd: 'C1',
      fhinmei: '名',
      fseiban: 'S1',
      machineName: 'raw',
      machineNameDisplay: 'RAW',
      csvDashboardRowId: null,
      plannedStartDateDisplay: '2026-01-01',
      plannedQuantity: 4,
      outsideDimensionsDisplay: '10',
    };
    expect(mapPalletVisualizationDtoToListItem(dto)).toEqual({
      id: 'x',
      palletNo: 2,
      fhincd: 'C1',
      fhinmei: '名',
      fseiban: 'S1',
      machineName: 'raw',
      machineNameDisplay: 'RAW',
      plannedStartDateDisplay: '2026-01-01',
      plannedQuantity: 4,
      outsideDimensionsDisplay: '10',
    });
  });
});
