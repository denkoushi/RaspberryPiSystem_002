import { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import { describe, expect, it, vi } from 'vitest';
import { acquireSessakuPieceLogicalLocks, decodeSessakuPieceParentItemId, encodeSessakuPieceKey, readSessakuPieceSet, readSessakuPieceSets, readSessakuPieceGeneration, sessakuPieceConflict, sessakuPieceKeyFromRow, sessakuPieceParentItemId, sessakuPieceIdFromItemId, sessakuPieceItemIds, resolveSessakuPieceItemKeys } from '../piece-key.js';
describe('piece identity and scoped generation', () => {
  it.each([['P2003', 'PIECE_REFERENCED'], ['P2002', 'STALE_SESSAKU_PIECES'], ['P2034', 'STALE_SESSAKU_PIECES']])('maps %s to a piece conflict', (code, expected) => {
    const error = new Prisma.PrismaClientKnownRequestError('constraint', { code, clientVersion: 'test' });
    expect(() => sessakuPieceConflict(error)).toThrowError(expect.objectContaining({ statusCode: 409, code: expected }));
  });
  it('preserves serialization failures for automatic runners', () => {
    const error = new Prisma.PrismaClientKnownRequestError('serialization', { code: 'P2034', clientVersion: 'test' });
    expect(() => sessakuPieceConflict(error, { preserveSerializationFailure: true })).toThrow(error);
  });
  it('loads boundaries for mutation and projection while loading completions only for projection', async () => {
    const key = { fseiban: 'S', fhincd: 'P', fsigencd: '021', fkojun: '1' };
    const findUnique = vi.fn().mockResolvedValue(null); const findMany = vi.fn().mockResolvedValue([]);
    const client = { productionScheduleSessakuPieceSet: { findUnique, findMany } } as never;
    await readSessakuPieceSet(client, key);
    expect(findUnique.mock.calls[0][0].include).toEqual({ pieces: { orderBy: { position: 'asc' }, include: { opSplits: { orderBy: { fromOpNo: 'asc' } } } } });
    await readSessakuPieceSets(client, [{ rowData: { FSEIBAN: 'S', FHINCD: 'P', FSIGENCD: '021', FKOJUN: '1' } }]);
    expect(findMany.mock.calls[0][0].include.pieces.include).toEqual({ opCompletions: { select: { opNo: true } }, opSplits: { orderBy: { fromOpNo: 'asc' } }, sourcePiece: { select: { opSplits: { select: { fromOpNo: true }, orderBy: { fromOpNo: 'desc' }, take: 1 } } } });
  });
  it('resolves all interval IDs to their original piece logical locks', async () => {
    const key = { fseiban: 'S', fhincd: 'P', fsigencd: '021', fkojun: '1' };
    const ids = sessakuPieceItemIds({ id: 'id', opSplits: [{ fromOpNo: 3 }, { fromOpNo: 5 }] });
    expect(ids).toEqual(['piece:id', 'pieceops:id:3', 'pieceops:id:5']);
    expect(ids.map(sessakuPieceIdFromItemId)).toEqual(['id', 'id', 'id']);
    const findMany = vi.fn().mockResolvedValue([{ id: 'id', pieceSet: key }]);
    const result = await resolveSessakuPieceItemKeys({ productionScheduleSessakuPiece: { findMany } } as never, ids);
    expect([...result.values()]).toEqual([key, key, key]);
    expect(findMany.mock.calls[0][0].where.id.in).toEqual(['id']);
  });
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
  it('fingerprints logical keys, set IDs and versions in Postgres in stable order', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ fingerprint: 'abc' }]);
    expect(await readSessakuPieceGeneration({ $queryRaw: queryRaw } as never)).toBe('abc');
    const text = (queryRaw.mock.calls[0][0] as Prisma.Sql).text;
    expect(text).toContain('md5(COALESCE(string_agg(jsonb_build_array(s."fseiban", s."fhincd", s."fsigencd", s."fkojun", s."id", s."version")');
    expect(text).toContain('ORDER BY s."id" COLLATE "C"');
    queryRaw.mockResolvedValue([]);
    expect(await readSessakuPieceGeneration({ $queryRaw: queryRaw } as never)).toBe('');
  });

  it('scopes parents by exact raw CSV logical keys and includes referenced sets', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const client = { $queryRaw: queryRaw } as never;
    await readSessakuPieceGeneration(client, { fseibans: ['A'] });
    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContainEqual(['A']);
    expect(query.text).toContain('SELECT DISTINCT COALESCE(r."rowData"');
    expect(query.text).toContain('(s."fseiban", s."fhincd", s."fsigencd", s."fkojun") IN');
    expect(query.text).toContain('SELECT "sourcePieceSetId" FROM parents');
    expect(query.text).toContain('source."pieceSetId"');
    await readSessakuPieceGeneration(client, { fseibans: [] });
    expect((queryRaw.mock.calls[1][0] as Prisma.Sql).values).toContainEqual([]);
    await readSessakuPieceGeneration(client);
    expect((queryRaw.mock.calls[2][0] as Prisma.Sql).text).not.toContain('FROM "CsvDashboardRow"');
  });
  it('takes the complete same-part lock group in one stable order from either process', async () => {
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

  it('reads 601 related seiban/part pairs in 300/300/1 batches and locks all unique keys once in global order', async () => {
    const keys = Array.from({ length: 601 }, (_, i) => ({ fseiban: `S${600 - i}`, fhincd: `P${i % 3}`, fsigencd: '021', fkojun: '1' }));
    const related = keys.map((key) => ({ ...key, fsigencd: '022', fkojun: '2' }));
    const findMany = vi.fn().mockImplementation(async ({ where }) => related.filter((key) =>
      where.OR.some((part: { fseiban: string; fhincd: string }) => part.fseiban === key.fseiban && part.fhincd === key.fhincd)));
    const queryRaw = vi.fn().mockImplementation(async (query: Prisma.Sql) => {
      const seibans = new Set(query.values.filter((_, index) => index % 2 === 1));
      return [...keys, ...related].filter((key) => seibans.has(key.fseiban)).map((key) => ({
        rowData: { FSEIBAN: key.fseiban, FHINCD: key.fhincd, FSIGENCD: key.fsigencd, FKOJUN: key.fkojun }
      })).reverse();
    });
    const tx = { productionScheduleSessakuPieceSet: { findMany }, $queryRaw: queryRaw, $executeRaw: vi.fn() };
    const locked = await acquireSessakuPieceLogicalLocks(tx as never, [...keys, keys[0], keys[300], keys[600]]);
    expect(findMany.mock.calls.map(([{ where }]) => where.OR.length)).toEqual([300, 300, 1]);
    expect(findMany.mock.calls.flatMap(([{ where }]) => {
      expect(where.csvDashboardId).toBe(PRODUCTION_SCHEDULE_DASHBOARD_ID);
      return where.OR;
    })).toEqual(keys.map(({ fseiban, fhincd }) => ({ fseiban, fhincd })));
    expect(queryRaw.mock.calls.map(([query]) => (query.values.length - 1) / 2)).toEqual([300, 300, 1]);
    queryRaw.mock.calls.forEach(([query], index) => {
      expect(query.text).toContain(`COALESCE(r."rowData"->>'FSEIBAN', '') =`);
      expect(query.text).toContain(`COALESCE(r."rowData"->>'FHINCD', '') =`);
      expect(query.values).toEqual([PRODUCTION_SCHEDULE_DASHBOARD_ID,
        ...keys.slice(index * 300, (index + 1) * 300).flatMap(({ fseiban, fhincd }) => [fseiban, fhincd])]);
    });
    const expected = [...keys, ...related].map(encodeSessakuPieceKey).sort();
    expect([...locked].sort()).toEqual(expected);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, locks] = tx.$executeRaw.mock.calls[0];
    expect(sql.join('')).toContain('WITH ORDINALITY');
    expect(sql.join('')).toContain('ORDER BY ordinal');
    expect(locks).toEqual(expected.map((key) => `sessaku-pieces:${PRODUCTION_SCHEDULE_DASHBOARD_ID}:${key}`));
    expect(new Set(locks).size).toBe(1202);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeGreaterThan(queryRaw.mock.invocationCallOrder[2]);
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
