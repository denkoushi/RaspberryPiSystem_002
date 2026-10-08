import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureMaterialService } from '../../../services/assembly/procedure-material.service.js';
import { registerProcedureMaterialRoutes } from '../procedure-materials.js';

const url = '/assembly/procedure-materials/semantic-search';
const payload = { q: '溶接', state: 'unplaced' };

describe('procedure material semantic search route', () => {
  let app: ReturnType<typeof Fastify>;
  afterEach(async () => { await app?.close(); });

  async function harness(denyView = false) {
    const rows = [
      { id: 'b2', gmailMessageId: 'b', kind: 'PHOTO', text: 'ページの文字', receivedAt: '2026-10-03', discardedAt: null, placedAt: null, documentId: null },
      { id: 'a', gmailMessageId: 'a', kind: 'TEXT', text: '一覧と同じ本文', receivedAt: '2026-10-02', discardedAt: null, placedAt: null, documentId: null },
      { id: 'standalone', gmailMessageId: null, kind: 'PDF', text: 'PDF の文字', receivedAt: '2026-10-02', discardedAt: null, placedAt: null, documentId: null },
      { id: 'b1', gmailMessageId: 'b', kind: 'PDF', text: 'PDF の文字', receivedAt: '2026-10-01', discardedAt: null, placedAt: null, documentId: null },
      { id: 'placed-at', gmailMessageId: 'a', kind: 'PHOTO', discardedAt: null, placedAt: '2026-10-01', documentId: null },
      { id: 'document', gmailMessageId: 'b', kind: 'PDF', discardedAt: null, placedAt: null, documentId: 'doc' },
      { id: 'discarded', gmailMessageId: 'a', kind: 'TEXT', discardedAt: '2026-10-01', placedAt: null, documentId: null },
    ];
    // Emulate the WHERE predicates; preserve the database's list order.
    const findMany = vi.fn(async ({ where }: { where: any }) => {
      const state = where.AND?.[0] ?? where;
      const scope = where.AND?.[1];
      return rows.filter(row => !row.discardedAt
        && (state.OR ? !!(row.documentId || row.placedAt) : !row.documentId && !row.placedAt)
        && (!scope || scope.OR[0].gmailMessageId.in.includes(row.gmailMessageId)
          || (row.gmailMessageId === null && scope.OR[1].id.in.includes(row.id))));
    });
    const rank = vi.fn().mockResolvedValue({ available: true, mode: 'semantic', recordIds: ['mail:a', 'mail:b', 'material:standalone', 'mail:a', 'mail:removed'] });
    app = Fastify(); registerErrorHandler(app);
    await app.register(rateLimit);
    registerProcedureMaterialRoutes(app, {
      service: new ProcedureMaterialService({ procedureMaterial: { findMany } } as never, {} as never, {} as never),
      semanticSearch: { rank },
      allowView: async () => { if (denyView) throw new ApiError(403, '閲覧不可'); },
      allowWriteKiosk: async () => { throw new ApiError(403, '書込み不可'); },
    });
    return { rank, findMany, rows };
  }

  it('expands mail and standalone ids, preserving rank and existing order within mail', async () => {
    const { rank, findMany, rows } = await harness();
    const response = await app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: true, mode: 'semantic', items: [rows[1], { ...rows[0], text: null }, { ...rows[3], text: null }, { ...rows[2], text: null }] });
    expect(rank).toHaveBeenCalledWith('procedure_material', '溶接', 100, ['mail:b', 'mail:a', 'material:standalone']);
    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { discardedAt: null, documentId: null, placedAt: null }, select: { id: true, gmailMessageId: true },
      orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { discardedAt: null, AND: [{ documentId: null, placedAt: null }, { OR: [
        { gmailMessageId: { in: ['a', 'b', 'a', 'removed'] } }, { id: { in: ['standalone'] }, gmailMessageId: null },
      ] }] }, orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('filters placed state and applies item limit after expansion', async () => {
    const { rank, findMany } = await harness();
    const response = await app.inject({ method: 'POST', url, payload: { ...payload, state: 'placed', limit: 1 } });
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual(['placed-at']);
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ documentId: { not: null } }, { placedAt: { not: null } }]);
    expect(rank).toHaveBeenCalledWith('procedure_material', '溶接', 100, ['mail:a', 'mail:b']);
    expect((await app.inject({ method: 'POST', url, payload: { ...payload, state: 'placed' } })).json().items.map((item: { id: string }) => item.id)).toEqual(['placed-at', 'document']);
  });

  it('uses the default 50-item limit and accepts 100', async () => {
    const { findMany } = await harness();
    findMany.mockResolvedValue(Array.from({ length: 120 }, (_, i) => ({ id: `${i}`, gmailMessageId: 'a' })) as never);
    expect((await app.inject({ method: 'POST', url, payload })).json().items).toHaveLength(50);
    expect((await app.inject({ method: 'POST', url, payload: { ...payload, limit: 100 } })).json().items).toHaveLength(100);
  });

  it('returns lexical mode or unavailable with HTTP 200 and skips expansion when unavailable', async () => {
    const { rank, findMany } = await harness();
    rank.mockResolvedValueOnce({ available: false, mode: 'unavailable', recordIds: [] });
    const response = await app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false, mode: 'unavailable', items: [] });
    expect(findMany).toHaveBeenCalledTimes(1);
    rank.mockResolvedValueOnce({ available: true, mode: 'lexical', recordIds: [] });
    expect((await app.inject({ method: 'POST', url, payload })).json()).toEqual({ available: true, mode: 'lexical', items: [] });
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('returns empty without ranking when no live material has the requested state', async () => {
    const { rank, rows } = await harness();
    for (const row of rows) row.discardedAt = '2026-10-01';
    expect((await app.inject({ method: 'POST', url, payload })).json()).toEqual({ available: true, mode: 'lexical', items: [] });
    expect(rank).not.toHaveBeenCalled();
  });

  it('requires allowView before calling the worker', async () => {
    const { rank, findMany } = await harness(true);
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(403);
    expect(rank).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled();
  });

  it.each([{ q: '' }, { q: '   ' }, { q: 'x'.repeat(201) }, { q: 1 }, { state: undefined },
    { state: 'discarded' }, { state: 'all' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '2' }])('rejects invalid input %j', async (invalid) => {
    const { rank } = await harness();
    expect((await app.inject({ method: 'POST', url, payload: { ...payload, ...invalid } })).statusCode).toBe(400);
    expect(rank).not.toHaveBeenCalled();
  });

  it('limits requests to 12 per minute', async () => {
    const { rank } = await harness();
    for (let i = 0; i < 12; i++) expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(429);
    expect(rank).toHaveBeenCalledTimes(12);
  });
});
