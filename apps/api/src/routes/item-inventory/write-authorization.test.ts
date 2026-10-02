import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/errors.js';

// The real token check runs here; only the client-key lookup and the service are replaced.
const { requireClientDeviceMock, processTransactionMock, correctStockMock, servicesMock } = vi.hoisted(() => {
  const services = {
    inventory: { processTransaction: vi.fn(), correctStock: vi.fn() },
    ingestion: { retryRecord: vi.fn(), runOnce: vi.fn() },
  };
  return {
    requireClientDeviceMock: vi.fn(),
    processTransactionMock: services.inventory.processTransaction,
    correctStockMock: services.inventory.correctStock,
    servicesMock: vi.fn(() => services),
  };
});

vi.mock('../../lib/kiosk-document-auth.js', () => ({ authorizeKioskClientKeyOrJwtRoles: vi.fn(async () => undefined) }));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: requireClientDeviceMock }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', () => ({ getItemInventoryServices: servicesMock }));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared',
  verifyDueManagementAccessPassword: vi.fn(),
}));

import { registerItemInventoryRoutes } from './index.js';

const transaction = { itemTagUid: 'item-tag', quantityTagUid: 'quantity-tag' };
const correction = { compartmentId: '00000000-0000-4000-8000-000000000001', desiredQuantity: 5 };
const staleToken = 'Bearer not-a-valid-token';

describe('item inventory stock-change authorization', () => {
  beforeEach(() => {
    processTransactionMock.mockReset().mockResolvedValue({ transaction: { id: 't1', createdAt: new Date() } });
    correctStockMock.mockReset().mockResolvedValue({ id: 't2', createdAt: new Date() });
    requireClientDeviceMock.mockReset().mockImplementation(async (key: unknown) => {
      if (key !== 'kiosk-key') throw new ApiError(401, 'クライアントキーが無効です', undefined, 'CLIENT_KEY_INVALID');
      return { clientKey: 'kiosk-key', clientDevice: { id: 'terminal-a' } };
    });
  });

  async function post(url: string, payload: object, headers: Record<string, string>) {
    const app = Fastify();
    registerItemInventoryRoutes(app);
    const response = await app.inject({ method: 'POST', url, payload, headers });
    await app.close();
    return response;
  }

  it('answers 200 when a stale token comes with a valid client key', async () => {
    // A browser that once logged in to the admin console keeps sending its expired token.
    // The stock change was saved on the client key but the response said 401 (2026-10-02).
    const issued = await post('/item-inventory/transactions', transaction, { authorization: staleToken, 'x-client-key': 'kiosk-key' });
    expect(issued.statusCode).toBe(200);
    expect(processTransactionMock).toHaveBeenCalledOnce();

    const corrected = await post('/item-inventory/corrections', correction, { authorization: staleToken, 'x-client-key': 'kiosk-key' });
    expect(corrected.statusCode).toBe(200);
    expect(correctStockMock).toHaveBeenCalledOnce();
  });

  it('rejects a request with no credentials with 401 and changes nothing', async () => {
    const response = await post('/item-inventory/transactions', transaction, {});
    expect(response.statusCode).toBe(401);
    expect(processTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects a stale token without a client key with 401 and changes nothing', async () => {
    const response = await post('/item-inventory/transactions', transaction, { authorization: staleToken });
    expect(response.statusCode).toBe(401);
    expect(processTransactionMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid client key with 401 and changes nothing, with or without a stale token', async () => {
    const keyOnly = await post('/item-inventory/transactions', transaction, { 'x-client-key': 'wrong-key' });
    expect(keyOnly.statusCode).toBe(401);

    const withToken = await post('/item-inventory/corrections', correction, { authorization: staleToken, 'x-client-key': 'wrong-key' });
    expect(withToken.statusCode).toBe(401);

    expect(processTransactionMock).not.toHaveBeenCalled();
    expect(correctStockMock).not.toHaveBeenCalled();
  });
});
