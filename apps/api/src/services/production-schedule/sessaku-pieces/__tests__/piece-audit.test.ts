import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../lib/prisma.js';
import { logger } from '../../../../lib/logger.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { z } from 'zod';
import { ApiError } from '../../../../lib/errors.js';
import { runSessakuPieceOperation, type PieceAuditContext } from '../piece-audit.js';
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { productionScheduleSessakuPieceAuditLog: { create: vi.fn() } } }));
vi.mock('../../../../lib/logger.js', () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  return { logger: { ...log, child: (_bindings: object, options: object) => { expect(options).toEqual({ level: 'info' }); return log; } } };
});
const context = (): PieceAuditContext => ({ action: 'split', requestId: 'req-1', siteKey: 'site', actorClientDeviceId: 'client', actorDeviceName: 'device', parentItemId: 'parent', fseiban: 'S1', pieceIds: ['piece-1'], expectedVersion: 1, itemRevision: 'revision', beforeJson: { count: 1, quantities: [5] } });
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
    expect(logger.info).toHaveBeenCalledExactlyOnceWith({ event: 'sessaku_piece.split', ...data, itemRevisions: null }, 'Sessaku piece operation');
  });
  it.each([400, 409, 500])('records rejection/failure %s and preserves the original error', async (status) => {
    const error = new ApiError(status, 'Safe domain message', undefined, 'PIECE_QUANTITY_CONFLICT');
    await expect(runSessakuPieceOperation(context(), async (audit) => {
      audit.afterJson = { quantities: [999] }; throw error;
    })).rejects.toBe(error);
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ outcome: status < 500 ? 'rejected' : 'failed', httpStatus: status, errorCode: error.code, afterJson: context().beforeJson, resultVersion: null });
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
  it('bounds both snapshots by serialized UTF-8 bytes in the DB and pino', async () => {
    const audit = context();
    audit.beforeJson = { count: 2, pieceIds: ['a', 'b'], padding: '片'.repeat(23000) };
    await runSessakuPieceOperation(audit, async (a) => { a.afterJson = { count: 3, padding: '片'.repeat(23000) }; });
    const data = vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mock.calls[0][0].data;
    expect(data.beforeJson).toMatchObject({ truncated: true, pieceCount: 2 });
    expect(data.afterJson).toMatchObject({ truncated: true, pieceCount: 3 });
    expect(Buffer.byteLength(JSON.stringify(data.beforeJson))).toBeLessThan(65536);
    expect(Buffer.byteLength(JSON.stringify(data.afterJson))).toBeLessThan(65536);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ beforeJson: data.beforeJson, afterJson: data.afterJson }), expect.any(String));
  });
  it.each([false, true])('audit failure does not change the response (operation throws=%s)', async (throws) => {
    vi.mocked(prisma.productionScheduleSessakuPieceAuditLog.create).mockRejectedValue(new Error('secret DB message'));
    const error = new Error('secret token');
    const pending = runSessakuPieceOperation(context(), async () => { if (throws) throw error; return 42; });
    if (throws) await expect(pending).rejects.toBe(error); else await expect(pending).resolves.toBe(42);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('secret');
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('secret');
  });
});
