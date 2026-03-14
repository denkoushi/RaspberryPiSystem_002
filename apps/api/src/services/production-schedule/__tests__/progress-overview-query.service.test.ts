import { describe, expect, it } from 'vitest';

import {
  splitProgressOverviewItems,
  type ProductionScheduleProgressOverviewSeibanItem
} from '../progress-overview-query.service.js';

const buildItem = (
  fseiban: string,
  dueDate: string | null
): ProductionScheduleProgressOverviewSeibanItem => ({
  fseiban,
  machineName: null,
  dueDate: dueDate ? new Date(dueDate) : null,
  parts: []
});

describe('progress-overview-query.service', () => {
  it('納期ありは納期昇順、同一納期は登録順で並ぶ', () => {
    const items = [
      buildItem('S-300', '2026-04-02T00:00:00.000Z'),
      buildItem('S-100', '2026-04-01T00:00:00.000Z'),
      buildItem('S-200', '2026-04-01T00:00:00.000Z'),
    ];
    const { scheduled } = splitProgressOverviewItems(items, ['S-200', 'S-100', 'S-300']);

    expect(scheduled.map((item) => item.fseiban)).toEqual(['S-200', 'S-100', 'S-300']);
  });

  it('納期未設定は登録順で並ぶ', () => {
    const items = [
      buildItem('S-300', null),
      buildItem('S-100', null),
      buildItem('S-200', null),
    ];
    const { unscheduled } = splitProgressOverviewItems(items, ['S-100', 'S-200', 'S-300']);

    expect(unscheduled.map((item) => item.fseiban)).toEqual(['S-100', 'S-200', 'S-300']);
  });
});
