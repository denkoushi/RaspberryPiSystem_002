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
      const tx = { productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([later, cutting]) }, $executeRaw: execute };
      await acquireSessakuPieceLogicalLocks(tx as never, [key]);
      calls.push(execute.mock.calls.map((call) => call[1] as string));
    }
    expect(calls[0]).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]).toEqual([...calls[0]].sort());
  });

});
