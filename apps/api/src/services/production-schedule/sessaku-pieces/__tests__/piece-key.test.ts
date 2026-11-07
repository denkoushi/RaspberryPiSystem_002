import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import { describe, expect, it, vi } from 'vitest';
import { acquireSessakuPieceLogicalLocks, decodeSessakuPieceParentItemId, encodeSessakuPieceKey, readSessakuPieceGeneration, sessakuPieceKeyFromRow, sessakuPieceParentItemId } from '../piece-key.js';
describe('piece identity and monotonic generation', () => {
  it('preserves exact winner key strings across encoding', () => {
    const key = sessakuPieceKeyFromRow({ FSEIBAN: ' A ', FHINCD: 'part', FSIGENCD: '01', FKOJUN: 2, ProductNo: 'unrelated' });
    expect(encodeSessakuPieceKey(key)).toBe('[" A ","part","01","2"]');
    expect(decodeSessakuPieceParentItemId(sessakuPieceParentItemId(key))).toEqual(key);
  });
  it.each(['piece:a', 'row:bad', 'row:WzFd'])('rejects malformed parent IDs %s', (value) => expect(() => decodeSessakuPieceParentItemId(value)).toThrow());
  it('rejects the unassigned manufacturing-order identity with 409', () => {
    const itemId = `row:${Buffer.from(JSON.stringify(['********', 'p', '1', '1', 'order'])).toString('base64url')}`;
    expect(() => decodeSessakuPieceParentItemId(itemId)).toThrowError(expect.objectContaining({ statusCode: 409, code: 'UNSUPPORTED_PIECE_PARENT' }));
  });
  it('retains sums above Number.MAX_SAFE_INTEGER', async () => {
    expect(await readSessakuPieceGeneration({ $queryRaw: vi.fn().mockResolvedValue([{ count: 3n, version: 9007199254740993n }]) } as never)).toEqual({ count: '3', version: '9007199254740993' });
  });  it('takes the complete same-part lock group in one stable order from either process', async () => {
    const cutting = { fseiban: 'A', fhincd: 'P', fsigencd: '1', fkojun: '2' };
    const later = { ...cutting, fsigencd: '305', fkojun: '10' };
    const calls: string[][] = [];
    for (const key of [cutting, later]) {
      const execute = vi.fn();
      const tx = { $queryRaw: vi.fn().mockResolvedValue([]), csvDashboardRow: { findMany: vi.fn().mockResolvedValue([]) }, productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([later, cutting]) }, $executeRaw: execute };
      await acquireSessakuPieceLogicalLocks(tx as never, [key]);
      expect(execute).toHaveBeenCalledTimes(1);
      const sql = execute.mock.calls[0][0].join('');
      expect(sql).toContain('WITH ORDINALITY');
      expect(sql).toContain('ORDER BY ordinal');
      calls.push(execute.mock.calls[0][1] as string[]);
    }
    expect(calls[0]).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual([...calls[0]].sort());
  });
  it('locks the same ordered row keys before any cutting or later set exists', async () => {
    const cutting = { fseiban: 'A', fhincd: 'P', fsigencd: '1', fkojun: '1' };
    const later = { ...cutting, fsigencd: '2', fkojun: '2' };
    const locks = [];
    for (const key of [cutting, later]) {
      const tx = { productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) }, $queryRaw: vi.fn().mockResolvedValue([
        { rowData: { FSEIBAN: 'A', FHINCD: 'P', FSIGENCD: '2', FKOJUN: '2' } },
        { rowData: { FSEIBAN: 'A', FHINCD: 'P', FSIGENCD: '1', FKOJUN: '1' } }
      ]), $executeRaw: vi.fn() };
      await acquireSessakuPieceLogicalLocks(tx as never, [key]);
      const query = tx.$queryRaw.mock.calls[0][0];
      expect(query.text).toContain(`COALESCE(r."rowData"->>'FSEIBAN', '') =`);
      expect(query.text).toContain(`COALESCE(r."rowData"->>'FHINCD', '') =`);
      expect(query.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, 'A', 'P']);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      locks.push(tx.$executeRaw.mock.calls[0][1]);
    }
    expect(locks[0]).toHaveLength(2);
    expect(locks[0]).toEqual(locks[1]);
    expect(locks[0]).toEqual([...locks[0]].sort());
  });

  it('expands only parts with sets for CSV while locking ordinary keys once', async () => {
    const cutting = { fseiban: 'A', fhincd: 'P', fsigencd: '1', fkojun: '1' };
    const later = { ...cutting, fsigencd: '2', fkojun: '2' };
    const ordinary = { ...cutting, fseiban: 'B' };
    const tx = { productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([cutting]) },
      $queryRaw: vi.fn().mockResolvedValue([{ rowData: { FSEIBAN: 'A', FHINCD: 'P', FSIGENCD: '2', FKOJUN: '2' } }]), $executeRaw: vi.fn() };
    await acquireSessakuPieceLogicalLocks(tx as never, [ordinary, cutting, ordinary], { onlyPartsWithSets: true });
    expect(tx.$queryRaw.mock.calls[0][0].values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID, 'A', 'P']);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0][1]).toEqual([cutting, later, ordinary].map((key) => `sessaku-pieces:${PRODUCTION_SCHEDULE_DASHBOARD_ID}:${encodeSessakuPieceKey(key)}`).sort());
    tx.productionScheduleSessakuPieceSet.findMany.mockResolvedValue([]);
    tx.$queryRaw.mockClear(); tx.$executeRaw.mockClear();
    await acquireSessakuPieceLogicalLocks(tx as never, [ordinary], { onlyPartsWithSets: true });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.$executeRaw.mock.calls[0][1]).toEqual([`sessaku-pieces:${PRODUCTION_SCHEDULE_DASHBOARD_ID}:${encodeSessakuPieceKey(ordinary)}`]);
  });
});
