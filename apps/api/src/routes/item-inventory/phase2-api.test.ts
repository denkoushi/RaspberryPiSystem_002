import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inventory, requireClientDeviceMock, verifyPasswordMock } = vi.hoisted(() => ({
  inventory: {
    processTouchTransaction: vi.fn(), deleteDrawer: vi.fn(), deleteShelf: vi.fn(), deleteTag: vi.fn(), dismissImport: vi.fn(), restoreImport: vi.fn(),
  },
  requireClientDeviceMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
}));
vi.mock('../../lib/kiosk-document-auth.js', () => ({ authorizeKioskClientKeyOrJwtRoles: vi.fn() }));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: requireClientDeviceMock }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', () => ({ getItemInventoryServices: () => ({ inventory }) }));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared', verifyDueManagementAccessPassword: verifyPasswordMock,
}));

import { ApiError } from '../../lib/errors.js';
import { registerErrorHandler } from '../../plugins/error-handler.js';
import { InventoryConflictError, InventoryInsufficientStockError } from '../../services/item-inventory/item-inventory.service.js';
import { registerItemInventoryRoutes } from './index.js';

const id = '00000000-0000-4000-8000-000000000001';
const clientHeaders = { 'x-client-key': 'kiosk-key' };
const setupRoutes = [
  { method: 'DELETE', url: `/item-inventory/drawers/${id}`, handler: inventory.deleteDrawer },
  { method: 'DELETE', url: `/item-inventory/shelves/${id}`, handler: inventory.deleteShelf },
  { method: 'DELETE', url: `/item-inventory/tags/${id}`, handler: inventory.deleteTag },
  { method: 'POST', url: `/item-inventory/imports/${id}/dismiss`, handler: inventory.dismissImport },
  { method: 'POST', url: `/item-inventory/imports/${id}/restore`, handler: inventory.restoreImport },
] as const;

async function request(method: 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: object) {
  const app = Fastify();
  registerErrorHandler(app);
  registerItemInventoryRoutes(app);
  try {
    return await app.inject({ method, url, headers, payload });
  } finally {
    await app.close();
  }
}

describe('inventory phase 2 API contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireClientDeviceMock.mockImplementation(async (key: string) => {
      if (key !== 'kiosk-key') throw new ApiError(401, '無効な端末', undefined, 'CLIENT_KEY_INVALID');
      return { clientDevice: { id: 'terminal-1' } };
    });
    verifyPasswordMock.mockResolvedValue({ success: true });
    inventory.processTouchTransaction.mockReset().mockResolvedValue({ transaction: { id, createdAt: new Date('2026-10-08T00:00:00Z') }, replayed: false });
    for (const route of setupRoutes) route.handler.mockReset().mockResolvedValue({ id });
    inventory.dismissImport.mockResolvedValue({ id, status: 'DISMISSED' });
    inventory.restoreImport.mockResolvedValue({ id, status: 'PENDING' });
  });

  it('allows a touch issue with just the client key and defaults restock to false', async () => {
    const response = await request('POST', '/item-inventory/touch-transactions', clientHeaders, { compartmentId: id, quantity: 1 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ transaction: { id, createdAt: '2026-10-08T00:00:00.000Z' }, replayed: false });
    expect(inventory.processTouchTransaction).toHaveBeenCalledWith({ compartmentId: id, quantity: 1, restock: false, actor: { clientId: 'terminal-1', performedByUserId: null } });
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it('accepts touch restock, balance check, and idempotency key and returns replayed', async () => {
    inventory.processTouchTransaction.mockResolvedValue({ transaction: { id, createdAt: new Date('2026-10-08T00:00:00Z') }, replayed: true });
    const payload = { compartmentId: id, quantity: 999999, restock: true, expectedBeforeQuantity: 0, idempotencyKey: 'touch-key' };
    const response = await request('POST', '/item-inventory/touch-transactions', { ...clientHeaders, authorization: 'Bearer stale' }, payload);
    expect(response.statusCode).toBe(200);
    expect(response.json().replayed).toBe(true);
    expect(inventory.processTouchTransaction).toHaveBeenCalledWith(expect.objectContaining(payload));
  });

  it.each([{ quantity: 0 }, { quantity: 1000000 }, { quantity: 1.5 }, { quantity: 1, expectedBeforeQuantity: -1 }, { quantity: 1, compartmentId: 'bad' }, { quantity: 1, idempotencyKey: '' }])('rejects invalid touch body %j', async (invalid) => {
    const response = await request('POST', '/item-inventory/touch-transactions', clientHeaders, { compartmentId: id, ...invalid });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe('VALIDATION_ERROR');
    expect(inventory.processTouchTransaction).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{}, { 'x-client-key': 'wrong' }])('rejects unauthorized touch requests %j', async (headers) => {
    const response = await request('POST', '/item-inventory/touch-transactions', headers, { compartmentId: id, quantity: 1 });
    expect(response.statusCode).toBe(401);
    expect(inventory.processTouchTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { error: new InventoryConflictError(), code: 'INVENTORY_CONFLICT' },
    { error: new InventoryInsufficientStockError(), code: 'INVENTORY_INSUFFICIENT_STOCK' },
  ])('maps touch failure to 409 $code', async ({ error, code }) => {
    inventory.processTouchTransaction.mockRejectedValue(error);
    const response = await request('POST', '/item-inventory/touch-transactions', clientHeaders, { compartmentId: id, quantity: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json().errorCode).toBe(code);
  });

  it.each(setupRoutes)('requires the existing setup PIN for $method $url', async ({ method, url, handler }) => {
    const denied = await request(method, url, clientHeaders);
    expect(denied.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    verifyPasswordMock.mockResolvedValueOnce({ success: false });
    const wrong = await request(method, url, { ...clientHeaders, 'x-kiosk-access-password': '9999' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().errorCode).toBe('INVENTORY_SETTINGS_ACCESS_DENIED');
    expect(handler).not.toHaveBeenCalled();
    const allowed = await request(method, url, { ...clientHeaders, 'x-kiosk-access-password': '1234' });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ result: { id, ...(handler === inventory.dismissImport ? { status: 'DISMISSED' } : handler === inventory.restoreImport ? { status: 'PENDING' } : {}) } });
    expect(handler).toHaveBeenCalledExactlyOnceWith(id);
    handler.mockRejectedValueOnce(new InventoryConflictError('削除・変更できません'));
    const conflict = await request(method, url, { ...clientHeaders, 'x-kiosk-access-password': '1234' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().errorCode).toBe('INVENTORY_CONFLICT');
  });
});
