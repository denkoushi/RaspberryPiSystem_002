import { describe, expect, it } from 'vitest';

import {
  collectLeaderboardBoardLaborMetadata,
  mergeLeaderboardBoardLaborMetadataForDisplay,
  readLeaderboardLaborMetadata,
  type LeaderboardLaborMetadata,
} from '../mergeLeaderboardBoardLaborMetadata';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

function row(id: string, machine: unknown, labor: unknown): ProductionScheduleRow {
  return {
    id,
    processingOrder: null,
    note: null,
    dueDate: null,
    rowData: {},
    machineRequiredMinutes: machine,
    laborRequiredMinutes: labor,
  } as unknown as ProductionScheduleRow;
}

function board(
  rows: ProductionScheduleRow[],
  deltaRows?: ProductionScheduleRow[]
): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows,
    resources: [],
    ...(deltaRows ? { deltaRows } : {}),
  } as unknown as ProductionScheduleLeaderboardBoardResponse;
}

describe('readLeaderboardLaborMetadata', () => {
  it('両方が有限数のときだけ返し、負数は 0 に丸める', () => {
    expect(readLeaderboardLaborMetadata(row('a', 30, 12.5))).toEqual({
      machineRequiredMinutes: 30,
      laborRequiredMinutes: 12.5,
    });
    expect(readLeaderboardLaborMetadata(row('a', -5, -0.1))).toEqual({
      machineRequiredMinutes: 0,
      laborRequiredMinutes: 0,
    });
  });

  it.each([
    [undefined, 1],
    [1, null],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    ['10', 1],
  ])('machine=%p labor=%p は欠損扱いで null', (machine, labor) => {
    expect(readLeaderboardLaborMetadata(row('a', machine, labor))).toBeNull();
  });
});

describe('collectLeaderboardBoardLaborMetadata', () => {
  it('board が無ければ false で map を変更しない', () => {
    const map = new Map<string, LeaderboardLaborMetadata>();
    expect(collectLeaderboardBoardLaborMetadata(undefined, map)).toBe(false);
    expect(map.size).toBe(0);
  });

  it('rows と deltaRows から収集し、欠損行は既存値を消さない', () => {
    const map = new Map<string, LeaderboardLaborMetadata>([
      ['missing', { machineRequiredMinutes: 7, laborRequiredMinutes: 3 }],
    ]);
    const changed = collectLeaderboardBoardLaborMetadata(
      board([row('r1', 10, 5), row('missing', undefined, undefined)], [row('d1', 20, 8)]),
      map
    );
    expect(changed).toBe(true);
    expect(Object.fromEntries(map)).toEqual({
      missing: { machineRequiredMinutes: 7, laborRequiredMinutes: 3 },
      r1: { machineRequiredMinutes: 10, laborRequiredMinutes: 5 },
      d1: { machineRequiredMinutes: 20, laborRequiredMinutes: 8 },
    });
  });

  it('値が同じなら changed=false、変わったら上書きして true', () => {
    const map = new Map<string, LeaderboardLaborMetadata>([['r1', { machineRequiredMinutes: 10, laborRequiredMinutes: 5 }]]);
    expect(collectLeaderboardBoardLaborMetadata(board([row('r1', 10, 5)]), map)).toBe(false);
    expect(collectLeaderboardBoardLaborMetadata(board([row('r1', 10, 6)]), map)).toBe(true);
    expect(map.get('r1')).toEqual({ machineRequiredMinutes: 10, laborRequiredMinutes: 6 });
  });

  it('deltaRows の同一 id は rows より後に評価され後勝ちになる', () => {
    const map = new Map<string, LeaderboardLaborMetadata>();
    collectLeaderboardBoardLaborMetadata(board([row('r1', 1, 1)], [row('r1', 2, 2)]), map);
    expect(map.get('r1')).toEqual({ machineRequiredMinutes: 2, laborRequiredMinutes: 2 });
  });
});

describe('mergeLeaderboardBoardLaborMetadataForDisplay', () => {
  it('displayBoard が無ければそのまま undefined', () => {
    expect(mergeLeaderboardBoardLaborMetadataForDisplay(undefined, board([row('r1', 1, 1)]))).toBeUndefined();
  });

  it('メタデータが無い / 差分が無いときは同一参照を返す', () => {
    const display = board([row('r1', 10, 5)]);
    expect(mergeLeaderboardBoardLaborMetadataForDisplay(display, undefined)).toBe(display);
    expect(mergeLeaderboardBoardLaborMetadataForDisplay(display, board([row('r1', 10, 5)]))).toBe(display);
    expect(mergeLeaderboardBoardLaborMetadataForDisplay(display, board([row('other', 1, 1)]))).toBe(display);
  });

  it('fresh board の工数で表示中の rows / deltaRows を補完し、入力は破壊しない', () => {
    const display = board([row('r1', undefined, undefined), row('r2', 3, 3)], [row('d1', 0, 0)]);
    const fresh = board([row('r1', 40, 15)], [row('d1', 9, 4)]);
    const merged = mergeLeaderboardBoardLaborMetadataForDisplay(display, fresh);
    expect(merged).not.toBe(display);
    expect(merged?.rows.map((r) => [r.id, r.machineRequiredMinutes, r.laborRequiredMinutes])).toEqual([
      ['r1', 40, 15],
      ['r2', 3, 3],
    ]);
    expect(merged?.rows[1]).toBe(display.rows[1]);
    expect(merged?.deltaRows?.map((r) => [r.id, r.machineRequiredMinutes, r.laborRequiredMinutes])).toEqual([
      ['d1', 9, 4],
    ]);
    expect(display.rows[0].machineRequiredMinutes).toBeUndefined();
  });

  it('保持済みメタデータより fresh board の値が優先される', () => {
    const display = board([row('r1', undefined, undefined)]);
    const retained = new Map([['r1', { machineRequiredMinutes: 1, laborRequiredMinutes: 1 }]]);
    expect(mergeLeaderboardBoardLaborMetadataForDisplay(display, undefined, retained)?.rows[0]).toMatchObject({
      machineRequiredMinutes: 1,
      laborRequiredMinutes: 1,
    });
    expect(
      mergeLeaderboardBoardLaborMetadataForDisplay(display, board([row('r1', 50, 20)]), retained)?.rows[0]
    ).toMatchObject({ machineRequiredMinutes: 50, laborRequiredMinutes: 20 });
    // 呼び出し側の保持 map は書き換えない
    expect(retained.get('r1')).toEqual({ machineRequiredMinutes: 1, laborRequiredMinutes: 1 });
  });

  it('deltaRows を持たない display には deltaRows キーを追加しない', () => {
    const merged = mergeLeaderboardBoardLaborMetadataForDisplay(
      board([row('r1', 0, 0)]),
      board([row('r1', 5, 5)], [row('x', 1, 1)])
    );
    expect(merged).not.toHaveProperty('deltaRows');
  });
});
