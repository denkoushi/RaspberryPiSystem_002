import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../lib/prisma.js';
import { logger } from '../../../../lib/logger.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { z } from 'zod';
import { ApiError } from '../../../../lib/errors.js';
import { readLaterPieceAuditSnapshots, collectLaterPiecePropagationAudits, writeLaterPiecePropagationAudits, runSessakuPieceOperation, type PieceAuditContext } from '../piece-audit.js';
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { productionScheduleSessakuPieceAuditLog: { create: vi.fn() } } }));
vi.mock('../../../../lib/logger.js', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  return { logger: { ...log, child: (_bindings: object, options: object) => { expect(options).toEqual({ level: 'info' }); return log; } } };
});
const context = (): PieceAuditContext => ({ action: 'split', requestId: 'req-1', siteKey: 'site', actorClientDeviceId: 'client', actorDeviceName: 'device', parentItemId: 'parent', fseiban: 'S1', pieceIds: ['piece-1'], requestedQuantities: [2, 3], expectedVersion: 1, itemRevision: 'revision', beforeJson: { count: 1, quantities: [5] } });
beforeEach(() => vi.resetAllMocks());
describe('runSessakuPieceOperation', () => {
  it('records one success after the operation settles', async () => {
    const result = await runSessakuPieceOperation(context(), async (audit) => {
      expect(prisma.productionScheduleSessakuPieceAuditLog.create).not.toHaveBeenCalled();
      audit.afterJson = { count: 2, quantities: [2, 3] }; audit.resultVersion = 2;
      return 'response';
    });
    expect(result).toBe('response');
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ ...context(), outcome: 'success', httpStatus: 200, errorCode: null, resultVersion: 2, afterJson: { count: 2, quantities: [2, 3] } });
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'sessaku_piece.split', requestId: 'req-1', action: 'split', outcome: 'success', httpStatus: 200, errorCode: null, siteKey: 'site', actorClientDeviceId: 'client', actorDeviceName: 'device', fseiban: 'S1', parentItemId: 'parent', pieceCount: 1, pieceIds: ['piece-1'], expectedVersion: 1, resultVersion: 2, requestedQuantities: [2, 3], totalMs: expect.any(Number), lockWaitMs: 0, beforeProjectionMs: 0, siteCount: 0, writeMs: 0, upsertCount: 0, afterProjectionMs: 0 }), 'Sessaku piece operation');
  });
  it.each([400, 409, 500])('records rejection/failure %s and preserves the original error', async (status) => {
    const error = new ApiError(status, 'Safe domain message', undefined, 'PIECE_QUANTITY_CONFLICT');
    await expect(runSessakuPieceOperation(context(), async (audit) => {
      audit.afterJson = { quantities: [999] }; throw error;
    })).rejects.toBe(error);
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ outcome: status < 500 ? 'rejected' : 'failed', httpStatus: status, errorCode: error.code, requestedQuantities: [2, 3], timing: expect.objectContaining({ totalMs: expect.any(Number) }), afterJson: context().beforeJson, resultVersion: null });
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'sessaku_piece.split', outcome: status < 500 ? 'rejected' : 'failed', httpStatus: status, errorCode: error.code }), 'Sessaku piece operation');
  });
  it.each([
    [new ApiError(403, 'disabled'), 403, 'API_ERROR_403'],
    [z.string().safeParse(null).error, 400, 'VALIDATION_ERROR'],
    [new PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: 'test' }), 404, 'P2025'],
    [new PrismaClientKnownRequestError('conflict', { code: 'P2002', clientVersion: 'test' }), 400, 'P2002'],
    [Object.assign(new Error('limited'), { statusCode: 429, code: 'IGNORED' }), 429, 'HTTP_429'],
    [new Error('unknown'), 500, 'UNHANDLED_ERROR'],
    [undefined, 500, 'UNHANDLED_ERROR']
  ])('classifies audit errors like the response handler (%s)', async (error, httpStatus, errorCode) => {
    await expect(runSessakuPieceOperation(context(), async () => { throw error; })).rejects.toBe(error);
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ httpStatus, errorCode }) });
  });
  it.each([false, true])('records committed IDs only (rollback=%s)', async (rollback) => {
    const pending = runSessakuPieceOperation(context(), async (audit) => {
      audit.resultPieceIds = ['piece-1', 'new-uncommitted-id'];
      audit.afterJson = { count: 2 };
      if (rollback) throw new Error('commit failed');
      return 'committed';
    });
    if (rollback) await expect(pending).rejects.toThrow('commit failed');
    else await expect(pending).resolves.toBe('committed');
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data.pieceIds).toEqual(rollback ? ['piece-1'] : ['piece-1', 'new-uncommitted-id']);
    expect(data).not.toHaveProperty('resultPieceIds');
  });
  it('bounds both DB snapshots by serialized UTF-8 bytes and omits them from pino', async () => {
    const audit = context();
    audit.beforeJson = { count: 2, pieceIds: ['a', 'b'], padding: '片'.repeat(23000) };
    await runSessakuPieceOperation(audit, async (a) => { a.afterJson = { count: 3, padding: '片'.repeat(23000) }; });
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data.beforeJson).toMatchObject({ truncated: true, pieceCount: 2 });
    expect(data.afterJson).toMatchObject({ truncated: true, pieceCount: 3 });
    expect(Buffer.byteLength(JSON.stringify(data.beforeJson))).toBeLessThan(65536);
    expect(Buffer.byteLength(JSON.stringify(data.afterJson))).toBeLessThan(65536);
    const logged = vi.mocked(logger.info).mock.calls[0][0];
    for (const field of ['beforeJson', 'afterJson', 'itemRevision', 'itemRevisions']) expect(logged).not.toHaveProperty(field);
  });
  it.each([false, true])('preserves requested quantities and timing separately from snapshots (failure=%s)', async (failed) => {
    const audit = context();
    audit.requestedQuantities = Array.from({ length: 25 }, (_, i) => i + 1);
    const stages = { sourceWinnerMs: 10, sourceDetailsMs: 11, sourcePieceSetsMs: 2, overridesMs: 3, ranksMs: 4, projectMs: 1, laneDiscoveryMs: 2, sourceRowCount: 70 };
    const run = runSessakuPieceOperation(audit, async (a) => {
      expect(a.timing).toMatchObject(Object.fromEntries(Object.keys(stages).map((key) => [key, 0])));
      Object.assign(a.timing!, { lockWaitMs: 12, beforeProjectionMs: 34, siteCount: 4, writeMs: 56, upsertCount: 180, afterProjectionMs: 7, ...stages });
      if (failed) throw new Error('rollback');
    });
    if (failed) await expect(run).rejects.toThrow('rollback'); else await run;
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data.requestedQuantities).toEqual(audit.requestedQuantities);
    expect(data.timing).toEqual({ ...audit.timing, totalMs: expect.any(Number) });
    expect(data.afterJson).not.toHaveProperty('requestedQuantities');
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ requestedQuantities: audit.requestedQuantities.slice(0, 20),
      lockWaitMs: 12, beforeProjectionMs: 34, siteCount: 4, writeMs: 56, upsertCount: 180, afterProjectionMs: 7, totalMs: expect.any(Number), ...stages }), expect.any(String));
  });
  it('keeps all IDs and revisions in the DB but logs only the ID count and first five', async () => {
    const audit = context();
    audit.resultPieceIds = Array.from({ length: 20 }, (_, i) => `piece-${i}`);
    audit.itemRevisions = { parent: 'revision' };
    await runSessakuPieceOperation(audit, async () => 'ok');
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pieceIds: audit.resultPieceIds, itemRevisions: audit.itemRevisions }) });
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ pieceCount: 20, pieceIds: audit.resultPieceIds.slice(0, 5) }), expect.any(String));
    expect(vi.mocked(logger.info).mock.calls[0][0]).not.toHaveProperty('itemRevisions');
  });
  it.each([false, true])('audit failure does not change the response (operation throws=%s)', async (throws) => {
    vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mockRejectedValue(new Error('secret DB message'));
    const error = new Error('secret token');
    const pending = runSessakuPieceOperation(context(), async () => { if (throws) throw error; return 42; });
    if (throws) await expect(pending).rejects.toBe(error); else await expect(pending).resolves.toBe(42);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ event: 'sessaku_piece.audit_write_failed', requestId: 'req-1', action: 'split' }, 'Sessaku piece audit write failed');
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret');
  });
  it.each(['fsigencd', 'fkojun'] as const)('prefers supported representatives and retains the last unsupported fallback (%s)', async (field) => {
    const key = { fseiban: 'S1', fhincd: 'P1', fsigencd: '1', fkojun: '1' };
    const blank = { ...key, [field]: '' };
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = { productionScheduleSessakuPieceSet: { findMany } } as unknown as Prisma.TransactionClient;
    expect((await readLaterPieceAuditSnapshots(tx, [key, blank]))[0].key).toEqual(key);
    expect((await readLaterPieceAuditSnapshots(tx, [blank, key]))[0].key).toEqual(key);
    const fallback = { ...blank, fsigencd: '' };
    expect((await readLaterPieceAuditSnapshots(tx, [blank, fallback]))[0].key).toEqual(fallback);
  });
  it('groups blank parent keys by manufacturing part without decoding and keeps different parts separate', async () => {
    const snapshot = (fhincd: string, quantity: number, fsigencd = '') => [{
      key: { fseiban: 'S1', fhincd, fsigencd, fkojun: '' },
      sets: [{ setId: fhincd, pieces: [{ id: fhincd, sourcePieceId: 'cut', quantity, isCompleted: false }] }]
    }];
    await writeLaterPiecePropagationAudits([
      ...collectLaterPiecePropagationAudits(snapshot('P1', 2), snapshot('P1', 3), 'site'),
      ...collectLaterPiecePropagationAudits(snapshot('P1', 3, '2'), snapshot('P1', 4), 'site'),
      ...collectLaterPiecePropagationAudits(snapshot('P2', 2), snapshot('P2', 3), 'site')
    ]);
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data).toMatchObject({
      beforeJson: { laterProcesses: snapshot('P1', 2)[0].sets }, afterJson: { laterProcesses: snapshot('P1', 4)[0].sets }
    });
  });
  it('warns without rejecting when post-commit audit preparation fails', async () => {
    const audit = { action: 'propagate', fseiban: 'S1', fhincd: 'P1', afterJson: {} };
    Object.defineProperty(audit, 'afterJson', { get: () => { throw new Error('secret payload'); } });
    await expect(writeLaterPiecePropagationAudits([audit])).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ event: 'sessaku_piece.audit_write_failed', action: 'propagate' }, 'Sessaku piece audit write failed');
  });
  it('combines committed batches into one propagate audit per manufacturing part', async () => {
    const key = { fseiban: 'S1', fhincd: 'P1', fsigencd: '1', fkojun: '1' };
    const snapshot = (quantity: number) => [{ key, sets: [{ setId: 'later-set', pieces: [{ id: 'later-piece', sourcePieceId: 'cut-piece', quantity, isCompleted: false }] }] }];
    const first = collectLaterPiecePropagationAudits(snapshot(2), snapshot(3), 'site');
    const second = collectLaterPiecePropagationAudits(snapshot(3), snapshot(4).map((part) => ({ ...part, key: { ...key, fsigencd: '2', fkojun: '2' } })), 'site');
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).not.toHaveBeenCalled();
    await writeLaterPiecePropagationAudits([...first, ...second]);
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleSessakuPieceAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'propagate', actorClientDeviceId: null,
      beforeJson: { laterProcesses: snapshot(2)[0].sets }, afterJson: { laterProcesses: snapshot(4)[0].sets } }) });
  });

});
