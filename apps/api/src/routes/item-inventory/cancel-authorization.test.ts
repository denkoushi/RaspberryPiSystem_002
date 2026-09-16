import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const { authorizeRolesMock, authorizeKioskMock, requireClientDeviceMock, cancelTransactionMock, servicesMock } = vi.hoisted(() => {
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
    servicesMock: vi.fn(() => services),
  };
});

vi.mock('../../lib/auth.js', () => ({ authorizeRoles: authorizeRolesMock }));
vi.mock('../../lib/kiosk-document-auth.js', () => ({ authorizeKioskClientKeyOrJwtRoles: authorizeKioskMock }));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: requireClientDeviceMock }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', () => ({ getItemInventoryServices: servicesMock }));

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
});
