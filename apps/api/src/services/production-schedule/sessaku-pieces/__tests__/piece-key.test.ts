import { describe, expect, it, vi } from 'vitest';
import { decodeSessakuPieceParentItemId, encodeSessakuPieceKey, readSessakuPieceGeneration, sessakuPieceKeyFromRow, sessakuPieceParentItemId } from '../piece-key.js';
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
  });
});
