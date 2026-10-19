import Fastify from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/errors.js';
import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { ProcedureManualCommonService } from '../../../services/assembly/procedure-manual-common.service.js';
import { registerProcedureManualRoutes } from '../procedure-manuals.js';

const app = Fastify();
const view = vi.fn(); const write = vi.fn();
const common = { list: vi.fn(), create: vi.fn(), saveCategory: vi.fn(), saveAction: vi.fn(), deleteCategory: vi.fn(), deleteAction: vi.fn() };
registerProcedureManualRoutes(app, { allowView: view, allowWriteKiosk: write, commonService: common as unknown as ProcedureManualCommonService, serializeSequence: value => value });
registerErrorHandler(app);
afterAll(() => app.close());
beforeEach(() => { vi.resetAllMocks(); view.mockResolvedValue(undefined); write.mockResolvedValue(undefined); });

describe('common manual API contracts', () => {
  it('uses view authorization for the common catalog', async () => {
    common.list.mockResolvedValue({ categories: [], actions: [], subjects: [] });
    const response = await app.inject('/assembly/procedure-manuals/common?published=true');
    expect(response.statusCode).toBe(200); expect(view).toHaveBeenCalledOnce();
    expect(common.list).toHaveBeenCalledWith(true);
  });

  it('returns create result and duplicate 409 Japanese message using write authorization', async () => {
    common.create.mockResolvedValue({ id: 'manual' });
    const input = { categoryId: 'tools', target: ' トルクレンチ ', actionId: 'use' };
    expect((await app.inject({ method: 'POST', url: '/assembly/procedure-manuals/common', payload: input })).json()).toEqual({ id: 'manual' });
    expect(common.create).toHaveBeenCalledWith({ ...input, target: 'トルクレンチ' });
    expect(write).toHaveBeenCalledOnce();
    common.create.mockRejectedValue(new ApiError(409, '同じ手順があります'));
    const duplicate = await app.inject({ method: 'POST', url: '/assembly/procedure-manuals/common', payload: input });
    expect(duplicate.statusCode).toBe(409); expect(duplicate.json().message).toBe('同じ手順があります');
  });

  it.each(['categories', 'actions'] as const)('validates and authorizes %s CRUD and preserves in-use 409', async kind => {
    const save = kind === 'categories' ? common.saveCategory : common.saveAction;
    const remove = kind === 'categories' ? common.deleteCategory : common.deleteAction;
    save.mockResolvedValue({ id: 'new', name: '追加' });
    const url = `/assembly/procedure-manuals/common/${kind}`;
    expect((await app.inject({ method: 'POST', url, payload: { name: ' 追加 ' } })).statusCode).toBe(200);
    expect(save).toHaveBeenCalledWith('追加', undefined);
    expect((await app.inject({ method: 'PATCH', url: `${url}/existing`, payload: { name: '変更' } })).statusCode).toBe(200);
    expect(save).toHaveBeenCalledWith('変更', 'existing');
    for (const name of [' ', 'a'.repeat(21)]) expect((await app.inject({ method: 'POST', url, payload: { name } })).statusCode).toBe(400);
    remove.mockRejectedValueOnce(new ApiError(409, '使用中です'));
    expect((await app.inject({ method: 'DELETE', url: `${url}/existing` })).statusCode).toBe(409);
    remove.mockResolvedValueOnce(undefined);
    expect((await app.inject({ method: 'DELETE', url: `${url}/existing` })).json()).toEqual({ deleted: true });
    expect(write).toHaveBeenCalledTimes(6);
  });

  it('rejects invalid kana and denies unauthorized mutations', async () => {
    expect((await app.inject({ method: 'POST', url: '/assembly/procedure-manuals/common', payload: { categoryId: 'tools', target: '研削盤', actionId: 'use', kanaRow: 'が' } })).statusCode).toBe(400);
    write.mockImplementation(() => { throw new ApiError(403, '権限がありません'); });
    expect((await app.inject({ method: 'POST', url: '/assembly/procedure-manuals/common/actions', payload: { name: '追加' } })).statusCode).toBe(403);
    expect(common.saveAction).not.toHaveBeenCalled();
  });

  it('returns 400 with the Japanese error for an oversized normalized target', async () => {
    common.create.mockImplementation(input => new ProcedureManualCommonService().create(input));
    const response = await app.inject({ method: 'POST', url: '/assembly/procedure-manuals/common', payload: {
      categoryId: 'tools', target: '㍿'.repeat(51), actionId: 'use', kanaRow: 'か'
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('対象が長すぎます');
  });
});
