import { describe, expect, it, vi } from 'vitest';

vi.mock('../superseded-order-carry-over.js', () => ({
  carryOverSupersededOrderData: vi.fn().mockResolvedValue({ targets: 1 }),
  lockSupersededOrderCarryOverPairs: vi.fn().mockResolvedValue([{ oldId: 'old' }]),
}));

import { lockSupersededOrderCarryOverPairs } from '../superseded-order-carry-over.js';
import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';
import {
  computeSupersededRowIds,
  refreshSupersededProductionScheduleRows,
  statusByKeyFromDedupedMailRows,
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

  it.each([
    { exact: undefined, other: ['X', 'X'], marks: ['old'] },
    { exact: undefined, other: ['X', 'P'], marks: [] },
    { exact: undefined, other: ['P', 'X'], marks: [] },
    { exact: undefined, other: [], marks: [] },
    { exact: 'P', other: ['X', 'X'], marks: [] },
    { exact: '', other: ['X', 'X'], marks: [] },
    { exact: 'X', other: ['P', 'X'], marks: ['old'] },
  ])('3列一致が $exact、他の工程コードが $other のときは $marks に印を付ける', ({ exact, other, marks }) => {
    const statuses = other.map((statusCode, i) => ({ fkoteicd: String(568 + i), statusCode }));
    if (exact !== undefined) statuses.push({ fkoteicd: '200', statusCode: exact });
    const statusByKey = statusByKeyFromDedupedMailRows([
      ...statuses.map((status) => ({ ...status, fkojun: '10', fsezono: '1' })),
      { fkoteicd: '568', statusCode: 'P', fkojun: '20', fsezono: '1' },
      { fkoteicd: '568', statusCode: 'P', fkojun: '10', fsezono: '3' },
    ]);
    expect([...computeSupersededRowIds([row('old', '1'), row('new', '2')], statusByKey)]).toEqual(marks);
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
  it('acquires the refresh lock before reading rows or mail inside the transaction', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ present: false }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)),
    };
    await refreshSupersededProductionScheduleRows(client as never);
    expect(client.$queryRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(String(tx.$executeRaw.mock.calls[0][0])).toContain("hashtext('production-schedule-superseded-refresh')");
    expect(String(tx.$executeRaw.mock.calls[1][0])).toContain("hashtext('fkojunst-status-mail-critical')");
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
  });

  it.each([true, false])('uses sorted old and new piece locks when cutting data moves (%s)', async (hasPieceData) => {
    const carryOver = await vi.importActual<typeof import('../superseded-order-carry-over.js')>('../superseded-order-carry-over.js');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]).mockResolvedValueOnce([{
        oldId: 'old', oldFseiban: 'S', oldFhincd: 'P', oldFsigencd: '200', oldFkojun: '10', oldProductNo: '9',
        targetId: 'new', targetFseiban: 'S', targetFhincd: 'P', targetFsigencd: '200', targetFkojun: '10', targetProductNo: '10',
        hasPieceData,
      }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await carryOver.lockSupersededOrderCarryOverPairs(tx as never, ['old'], []);
    const pieceLock = tx.$executeRaw.mock.calls.find(([query]) => String(query).includes('logical_locks'));
    const boardLockIndex = tx.$executeRaw.mock.calls.findIndex(([query]) => String(query).includes('sessaku-piece-board-states'));
    expect(boardLockIndex).toBe(hasPieceData ? 1 : 0);
    if (hasPieceData) {
      expect(pieceLock?.[1]).toEqual(['10', '9'].map((number) =>
        expect.stringContaining(JSON.stringify(['S', 'P', '200', '10', number]))));
    } else {
      expect(pieceLock).toBeUndefined();
    }
  });

  it('preserves existing marks when there are no readable mail rows', async () => {
    const queryRaw = vi.fn(async ({ sql }: { sql: string }) =>
      sql.includes('AS "marked"') ? [{ ...row('old', '1'), marked: true }] : [{ present: false }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const result = await refreshSupersededProductionScheduleRows(
      { $queryRaw: queryRaw, $executeRaw: executeRaw } as never
    );
    expect(result).toMatchObject({ marked: 0, cleared: 0, supersededNow: 1, carriedOver: null });
    expect(queryRaw.mock.calls.some(([query]) => query.sql.includes('UPDATE "CsvDashboardRow"'))).toBe(false);
  });

  it('clears a mark without fetching mail statuses when a group has only one distinct order number', async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([
        { ...row('old', '1'), marked: true },
        { ...row('same-order', '1'), marked: false },
      ])
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([{ id: 'old' }]);

    const result = await refreshSupersededProductionScheduleRows({
      $queryRaw: queryRaw, $executeRaw: vi.fn().mockResolvedValue(1),
    } as never);

    expect(result).toMatchObject({ marked: 0, cleared: 1, supersededNow: 0 });
    expect(queryRaw).toHaveBeenCalledTimes(3);
    expect(queryRaw.mock.calls[1][0].sql).toContain('SELECT EXISTS');
    expect(queryRaw.mock.calls[2][0].sql).toContain('SET "supersededAt" = CASE');
  });


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
    const mailQuery = queryRaw.mock.calls[1][0];
    expect(mailQuery.sql).toContain(`BTRIM(r."rowData"->>'FSEZONO') = ANY(?::text[])`);
    expect(mailQuery.values).toEqual([['1', '2']]);
    expect(lockSupersededOrderCarryOverPairs).toHaveBeenCalledWith(expect.anything(), ['old'], ['stale']);
    expect(vi.mocked(lockSupersededOrderCarryOverPairs).mock.invocationCallOrder.at(-1))
      .toBeLessThan(queryRaw.mock.invocationCallOrder[2]);
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
