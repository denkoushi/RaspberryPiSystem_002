import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const { authorizeRolesMock, authorizeKioskMock, requireClientDeviceMock, cancelTransactionMock, listPendingImportsMock, verifyDueManagementAccessPasswordMock, servicesMock } = vi.hoisted(() => {
  const authorizeRoles = vi.fn((...roles: string[]) => async (request: any) => {
    if (request.headers.authorization === 'Bearer admin' && roles.includes('ADMIN')) {
      request.user = { id: 'admin-user', role: 'ADMIN' };
      return;
    }
    if (request.headers.authorization === 'Bearer viewer' && roles.includes('ADMIN')) {
      request.user = { id: 'viewer-user', role: 'VIEWER' };
      throw Object.assign(new Error('viewer cannot manage inventory'), { statusCode: 403 });
    }
    throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
  });
  const cancelTransaction = vi.fn();
  const services = {
    inventory: {
      cancelTransaction,
      listPendingImports: vi.fn(),
    },
    ingestion: {
      retryRecord: vi.fn(),
      runOnce: vi.fn(),
    },
  };
  return {
    authorizeRolesMock: authorizeRoles,
    authorizeKioskMock: vi.fn(async () => undefined),
    requireClientDeviceMock: vi.fn(async () => ({ clientDevice: { id: 'terminal-b' } })),
    cancelTransactionMock: cancelTransaction,
    listPendingImportsMock: services.inventory.listPendingImports,
    verifyDueManagementAccessPasswordMock: vi.fn(),
    servicesMock: vi.fn(() => services),
  };
});

vi.mock('../../lib/auth.js', () => ({ authorizeRoles: authorizeRolesMock }));
vi.mock('../../lib/kiosk-document-auth.js', () => ({ authorizeKioskClientKeyOrJwtRoles: authorizeKioskMock }));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: requireClientDeviceMock }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', () => ({ getItemInventoryServices: servicesMock }));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared',
  verifyDueManagementAccessPassword: verifyDueManagementAccessPasswordMock,
}));

import { registerItemInventoryRoutes } from './index.js';

describe('item inventory cancellation authorization', () => {
  it('does not treat a VIEWER JWT plus a valid client key as admin cancellation', async () => {
    const app = Fastify();
    const transactionId = '00000000-0000-4000-8000-000000000001';
    cancelTransactionMock.mockResolvedValueOnce({ id: 'cancelled', createdAt: new Date() });
    registerItemInventoryRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: `/item-inventory/transactions/${transactionId}/cancel`,
      headers: { authorization: 'Bearer viewer', 'x-client-key': 'terminal-secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(cancelTransactionMock).toHaveBeenCalledWith(
      transactionId,
      { clientId: 'terminal-b', performedByUserId: 'viewer-user' },
      { allowAnyClient: false },
    );
    await app.close();
  });

  it('allows kiosk inventory settings reads after verifying the shared password', async () => {
    const app = Fastify();
    listPendingImportsMock.mockClear();
    verifyDueManagementAccessPasswordMock.mockClear();
    listPendingImportsMock.mockResolvedValueOnce([]);
    verifyDueManagementAccessPasswordMock.mockResolvedValueOnce({ success: true });
    registerItemInventoryRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/item-inventory/imports',
      headers: { 'x-client-key': 'terminal-secret', 'x-kiosk-access-password': '2520' },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyDueManagementAccessPasswordMock).toHaveBeenCalledWith({ location: 'shared', password: '2520' });
    expect(listPendingImportsMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects kiosk inventory settings requests with an invalid password', async () => {
    const app = Fastify();
    listPendingImportsMock.mockClear();
    verifyDueManagementAccessPasswordMock.mockClear();
    verifyDueManagementAccessPasswordMock.mockResolvedValueOnce({ success: false });
    registerItemInventoryRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/item-inventory/imports',
      headers: { 'x-client-key': 'terminal-secret', 'x-kiosk-access-password': '0000' },
    });

    expect(response.statusCode).toBe(403);
    expect(listPendingImportsMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('limits repeated invalid password attempts without limiting successful settings operations', async () => {
    const app = Fastify();
    const clientKey = 'terminal-rate-limit';
    listPendingImportsMock.mockClear();
    verifyDueManagementAccessPasswordMock.mockClear().mockResolvedValue({ success: false });
    registerItemInventoryRoutes(app);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await app.inject({
        method: 'GET',
        url: '/item-inventory/imports',
        headers: { 'x-client-key': clientKey, 'x-kiosk-access-password': '0000' },
      });
      expect(response.statusCode).toBe(403);
    }
    const blockedResponse = await app.inject({
      method: 'GET',
      url: '/item-inventory/imports',
      headers: { 'x-client-key': clientKey, 'x-kiosk-access-password': '0000' },
    });

    expect(blockedResponse.statusCode).toBe(429);
    expect(verifyDueManagementAccessPasswordMock).toHaveBeenCalledTimes(10);
    await app.close();
  });
});
