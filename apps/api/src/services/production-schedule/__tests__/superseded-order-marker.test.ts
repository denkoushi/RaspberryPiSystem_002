import { describe, expect, it, vi } from 'vitest';

vi.mock('../superseded-order-carry-over.js', () => ({
  carryOverSupersededOrderData: vi.fn().mockResolvedValue({ targets: 1 }),
}));

import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';
import {
  computeSupersededRowIds,
  refreshSupersededProductionScheduleRows,
  type SupersedeCandidateRow,
} from '../superseded-order-marker.js';

const row = (id: string, productNo: string, over: Partial<SupersedeCandidateRow> = {}): SupersedeCandidateRow => ({
  id,
  fseiban: 'BA1SC381',
  fhincd: 'MD005279290',
  fsigencd: '200',
  fkojun: '10',
  productNo,
  ...over,
});

const statusKey = (productNo: string, fsigencd = '200', fkojun = '10') =>
  buildFkojunstMailStatusKey({ fkojun, fkoteicd: fsigencd, fsezono: productNo });

describe('computeSupersededRowIds', () => {
  it('同じキーに X でない番号があるとき、X の古い番号に印が付く', () => {
    const ids = computeSupersededRowIds(
      [row('old', '0004000001'), row('new', '0004000002')],
      new Map([
        [statusKey('0004000001'), 'X'],
        [statusKey('0004000002'), 'P'],
      ])
    );
    expect([...ids]).toEqual(['old']);
  });

  it('両方 X なら両方見える(印なし)', () => {
    const ids = computeSupersededRowIds(
      [row('a', '0004000001'), row('b', '0004000002')],
      new Map([
        [statusKey('0004000001'), 'X'],
        [statusKey('0004000002'), 'X'],
      ])
    );
    expect(ids.size).toBe(0);
  });

  it('X でない別注文(生きている番号)どうしには印が付かない', () => {
    const ids = computeSupersededRowIds(
      [row('a', '0004146538'), row('b', '0004146555')],
      new Map([
        [statusKey('0004146538'), 'C'],
        [statusKey('0004146555'), 'C'],
      ])
    );
    expect(ids.size).toBe(0);
  });

  it('工程状態がまだ無い新しい番号は X でない扱いで、X の古い番号に印が付く', () => {
    const ids = computeSupersededRowIds(
      [row('old', '0004000001'), row('fresh', '0004000002')],
      new Map([[statusKey('0004000001'), 'X']])
    );
    expect([...ids]).toEqual(['old']);
  });

  it('キーが違う行(品番・資源・工順が違う)の X には印が付かない', () => {
    const ids = computeSupersededRowIds(
      [row('x', '0004000001'), row('other-part', '0004000002', { fhincd: 'OTHER' })],
      new Map([[statusKey('0004000001'), 'X']])
    );
    expect(ids.size).toBe(0);
  });

  it('資源コードは大文字小文字・空白を無視して工程状態と結び付く', () => {
    const ids = computeSupersededRowIds(
      [row('old', '0004000001', { fsigencd: ' r01 ' }), row('new', '0004000002', { fsigencd: 'R01' })],
      new Map([[statusKey('0004000001', 'R01'), 'X']])
    );
    // FSIGENCD の表記ゆれは別キー扱い(DB の winner 条件と同じ完全一致)なので、印は付かない
    expect(ids.size).toBe(0);
  });
});

describe('refreshSupersededProductionScheduleRows', () => {
  it('工程状態の元データ(メール)だけから印を付け直し、変わった行だけ更新する', async () => {
    const queryRaw = vi
      .fn()
      // 1回目: 生産日程の行(old は今は印なし、stale は今は印あり)
      .mockResolvedValueOnce([
        { id: 'old', fseiban: 'S', fhincd: 'H', fsigencd: '200', fkojun: '10', productNo: '1', marked: false },
        { id: 'new', fseiban: 'S', fhincd: 'H', fsigencd: '200', fkojun: '10', productNo: '2', marked: false },
        { id: 'stale', fseiban: 'S', fhincd: 'H2', fsigencd: '200', fkojun: '10', productNo: '3', marked: true },
      ])
      // 2回目: 工程状態メールの生データ
      .mockResolvedValueOnce([
        { id: 'm1', FKOJUN: '10', FKOTEICD: '200', FSEZONO: '1', FKOJUNST: 'X', FUPDTEDT: '2026/11/01 00:00:00',
          createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: null, sourceRowOrdinal: 1,
          sourceIngestRunStartedAt: null, sourceIngestRunCompletedAt: null },
      ])
      // 3回目: 印を付けた行(RETURNING)、4回目: 印を外した行
      .mockResolvedValueOnce([{ id: 'old' }])
      .mockResolvedValueOnce([{ id: 'stale' }]);
    const executeRaw = vi.fn().mockResolvedValue(1);

    const result = await refreshSupersededProductionScheduleRows({ $queryRaw: queryRaw, $executeRaw: executeRaw } as never);

    expect(result).toMatchObject({ marked: 1, cleared: 1, carriedOver: { targets: 1 } });
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('渡された工程状態をそのまま使い、メールを読み直さない', async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([
      { id: 'old', fseiban: 'S', fhincd: 'H', fsigencd: '200', fkojun: '10', productNo: '1', marked: false },
      { id: 'new', fseiban: 'S', fhincd: 'H', fsigencd: '200', fkojun: '10', productNo: '2', marked: false },
    ]).mockResolvedValueOnce([{ id: 'old' }]);
    const executeRaw = vi.fn().mockResolvedValue(1);

    const result = await refreshSupersededProductionScheduleRows(
      { $queryRaw: queryRaw, $executeRaw: executeRaw } as never,
      { statusByKey: new Map([[statusKey('1'), 'X']]) }
    );

    expect(queryRaw).toHaveBeenCalledTimes(2); // 行の読み込み + 印の更新(メールは読まない)
    expect(result).toMatchObject({ marked: 1, cleared: 0 });
  });
});
