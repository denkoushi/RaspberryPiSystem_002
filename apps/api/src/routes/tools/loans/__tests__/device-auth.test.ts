import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';

import { signAccessToken } from '../../../../lib/auth.js';
import { prisma } from '../../../../lib/prisma.js';
import { registerErrorHandler } from '../../../../plugins/error-handler.js';
import { LoanService } from '../../../../services/tools/loan.service.js';
import { registerActiveLoansRoute } from '../active.js';
import { registerBorrowRoute } from '../borrow.js';
import { registerLoanCancelRoute } from '../cancel.js';
import { registerPhotoBorrowRoute } from '../photo-borrow.js';
import { registerReturnRoute } from '../return.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: { clientDevice: { findUnique: vi.fn() } },
}));

const clientId = '11111111-1111-4111-8111-111111111111';
const otherClientId = '22222222-2222-4222-8222-222222222222';
const loanId = '33333333-3333-4333-8333-333333333333';
const clientKey = 'fixture-only-device-key';
const routes = [
  { path: '/borrow', payload: { itemTagUid: 'ITEM-TAG', employeeTagUid: 'EMP-TAG' }, method: 'borrow' },
  { path: '/photo-borrow', payload: { employeeTagUid: 'EMP-TAG', photoData: 'fixture-photo' }, method: 'photoBorrow' },
  { path: '/return', payload: { loanId }, method: 'return' },
  { path: '/cancel', payload: { loanId }, method: 'cancel' },
] as const;

describe('貸出ルートのデバイス認証', () => {
  let app: ReturnType<typeof Fastify>;
  let loanService: LoanService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.clientDevice.findUnique).mockImplementation(async (args) => {
      if (args.where.apiKey === clientKey || args.where.id === clientId) {
        return { id: clientId, canProxyOtherDevices: false } as never;
      }
      return null;
    });
    loanService = Object.create(LoanService.prototype) as LoanService;
    for (const { method } of routes) {
      vi.spyOn(loanService, method).mockResolvedValue({ id: loanId, clientId } as never);
    }
    vi.spyOn(loanService, 'findActive').mockResolvedValue([]);
    app = Fastify();
    registerErrorHandler(app);
    registerBorrowRoute(app, loanService);
    registerPhotoBorrowRoute(app, loanService);
    registerActiveLoansRoute(app, loanService);
    registerReturnRoute(app, loanService);
    registerLoanCancelRoute(app, loanService);
  });

  afterEach(async () => { await app.close(); });

  describe.each(routes)('$path', ({ path, payload, method }) => {
    it.each([
      { key: undefined, specifiedClientId: undefined },
      { key: undefined, specifiedClientId: clientId },
      { key: 'fixture-only-invalid', specifiedClientId: undefined },
      { key: 'fixture-only-invalid', specifiedClientId: clientId },
    ])('キーが無いか不正な場合は401を返す ($key, $specifiedClientId)', async ({ key, specifiedClientId }) => {
      const response = await app.inject({
        method: 'POST', url: path,
        headers: key ? { 'x-client-key': key } : {},
        payload: { ...payload, clientId: specifiedClientId },
      });
      expect(response.statusCode).toBe(401);
      expect(loanService[method]).not.toHaveBeenCalled();
    });

    it.each([undefined, clientId])('正しいキーで成功する (%s)', async (specifiedClientId) => {
      const response = await app.inject({
        method: 'POST', url: path, headers: { 'x-client-key': clientKey },
        payload: { ...payload, clientId: specifiedClientId },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().loan.clientId).toBe(clientId);
      expect(vi.mocked(loanService[method]).mock.calls[0]?.[1]).toBe(clientId);
    });

    it('代理権限のないclientId不一致は403を返す', async () => {
      const response = await app.inject({
        method: 'POST', url: path, headers: { 'x-client-key': clientKey },
        payload: { ...payload, clientId: otherClientId },
      });
      expect(response.statusCode).toBe(403);
      expect(loanService[method]).not.toHaveBeenCalled();
    });

    it('代理権限があれば登録済みの別端末を指定できる', async () => {
      vi.mocked(prisma.clientDevice.findUnique).mockImplementation(async (args) => {
        if (args.where.apiKey === clientKey) return { id: clientId, canProxyOtherDevices: true } as never;
        if (args.where.id === otherClientId) return { id: otherClientId } as never;
        return null;
      });
      const response = await app.inject({
        method: 'POST', url: path, headers: { 'x-client-key': clientKey },
        payload: { ...payload, clientId: otherClientId },
      });
      expect(response.statusCode).toBe(200);
      expect(vi.mocked(loanService[method]).mock.calls[0]?.[1]).toBe(otherClientId);
    });
  });

  it.each(['/borrow', '/photo-borrow'])('%sはJWTだけでは401を返す', async (path) => {
    const token = signAccessToken({ id: 'user-fixture', username: 'fixture', role: 'ADMIN' } as User);
    const route = routes.find((candidate) => candidate.path === path)!;
    const response = await app.inject({
      method: 'POST', url: path, headers: { authorization: `Bearer ${token}` }, payload: route.payload,
    });
    expect(response.statusCode).toBe(401);
    expect(loanService[route.method]).not.toHaveBeenCalled();
  });

  it.each([undefined, 'fixture-only-invalid'])('activeはキーもJWTも無いか不正なら401を返す (%s)', async (key) => {
    for (const query of ['', `?clientId=${clientId}`]) {
      const response = await app.inject({
        method: 'GET', url: `/active${query}`, headers: key ? { 'x-client-key': key } : {},
      });
      expect(response.statusCode).toBe(401);
    }
    expect(loanService.findActive).not.toHaveBeenCalled();
  });

  it('activeは正しいキーで全件表示し、明示されたclientIdだけで絞り込む', async () => {
    for (const query of ['', `?clientId=${clientId}`]) {
      expect((await app.inject({ method: 'GET', url: `/active${query}`, headers: { 'x-client-key': clientKey } })).statusCode).toBe(200);
    }
    expect(loanService.findActive).toHaveBeenNthCalledWith(1, { clientId: undefined });
    expect(loanService.findActive).toHaveBeenNthCalledWith(2, { clientId });
  });

  it('activeは代理権限のないclientId不一致を403にする', async () => {
    const response = await app.inject({ method: 'GET', url: `/active?clientId=${otherClientId}`, headers: { 'x-client-key': clientKey } });
    expect(response.statusCode).toBe(403);
    expect(loanService.findActive).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'MANAGER', 'VIEWER'] as const)('activeは%sのJWTだけでも成功する', async (role) => {
    const token = signAccessToken({ id: 'user-fixture', username: 'fixture', role } as User);
    const response = await app.inject({ method: 'GET', url: '/active', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(loanService.findActive).toHaveBeenCalledWith({ clientId: undefined });
    expect(prisma.clientDevice.findUnique).not.toHaveBeenCalled();
  });

  it.each(['/return', '/cancel'])('%sは既存のJWTだけの経路を維持する', async (path) => {
    const token = signAccessToken({ id: 'user-fixture', username: 'fixture', role: 'MANAGER' } as User);
    for (const specifiedClientId of [undefined, clientId]) {
      const response = await app.inject({
        method: 'POST', url: path, headers: { authorization: `Bearer ${token}` },
        payload: { loanId, clientId: specifiedClientId },
      });
      expect(response.statusCode).toBe(200);
    }
    const method = path === '/return' ? 'return' : 'cancel';
    expect(loanService[method]).toHaveBeenNthCalledWith(1, path === '/return' ? { loanId } : loanId, undefined, 'user-fixture');
    expect(loanService[method]).toHaveBeenNthCalledWith(2, path === '/return' ? { loanId, clientId } : loanId, clientId, 'user-fixture');
  });

  it('/activeは不正キーでも有効なJWTがあれば閲覧できる', async () => {
    const token = signAccessToken({ id: 'user-fixture', username: 'fixture', role: 'VIEWER' } as User);
    const response = await app.inject({
      method: 'GET', url: '/active',
      headers: { authorization: `Bearer ${token}`, 'x-client-key': 'fixture-only-invalid' },
    });
    expect(response.statusCode).toBe(200);
  });

  it.each(['/borrow', '/photo-borrow', '/return', '/cancel'])('%sはJWTがあっても不正キーを401にする', async (path) => {
    const token = signAccessToken({ id: 'user-fixture', username: 'fixture', role: 'ADMIN' } as User);
    const route = routes.find((candidate) => candidate.path === path);
    const response = await app.inject({
      method: route ? 'POST' : 'GET', url: path,
      headers: { authorization: `Bearer ${token}`, 'x-client-key': 'fixture-only-invalid' },
      ...(route ? { payload: { ...route.payload, clientId } } : {}),
    });
    expect(response.statusCode).toBe(401);
  });
});
