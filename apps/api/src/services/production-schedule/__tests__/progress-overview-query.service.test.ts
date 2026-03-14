import { describe, expect, it } from 'vitest';

import {
  normalizeProgressOverviewParts,
  resolveProgressOverviewResourceNames,
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

  it('partは有効processを持つ行のみ残し、納期昇順で並ぶ', () => {
    const parts = normalizeProgressOverviewParts([
      {
        productNo: 'P-200',
        fhincd: 'H-200',
        fhinmei: '部品B',
        dueDate: new Date('2026-04-03T00:00:00.000Z'),
        processes: [{ rowId: 'r-1', resourceCd: 'A1', processOrder: 1, isCompleted: false }]
      },
      {
        productNo: 'P-100',
        fhincd: 'H-100',
        fhinmei: '部品A',
        dueDate: new Date('2026-04-01T00:00:00.000Z'),
        processes: [{ rowId: 'r-2', resourceCd: 'A2', processOrder: 1, isCompleted: false }]
      },
      {
        productNo: 'P-999',
        fhincd: 'H-999',
        fhinmei: '除外対象',
        dueDate: new Date('2026-04-02T00:00:00.000Z'),
        processes: []
      }
    ]);

    expect(parts).toHaveLength(2);
    expect(parts.map((part) => part.fhincd)).toEqual(['H-100', 'H-200']);
  });

  it('resourceCdに紐づく名称配列を返す', () => {
    const map = {
      A1: ['研削機A', '研削機A予備'],
      A2: ['切削機B']
    };

    expect(resolveProgressOverviewResourceNames('A1', map)).toEqual(['研削機A', '研削機A予備']);
    expect(resolveProgressOverviewResourceNames('UNKNOWN', map)).toBeUndefined();
  });
});
