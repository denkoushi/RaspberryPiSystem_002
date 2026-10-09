import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    clientDevice: { findUnique: vi.fn() },
    inventoryCompartment: { findUnique: vi.fn() },
    inventoryNfcTag: { findUnique: vi.fn() },
  },
}));
vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', async () => {
  const { ItemInventoryService } = await import('../../services/item-inventory/item-inventory.service.js');
  return { getItemInventoryServices: () => ({ inventory: new ItemInventoryService(db as never) }) };
});

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerItemInventoryRoutes } from './index.js';

const item = {
  id: 'item-1', itemCode: 'RI-2-TEST', name: '治具', model: null, usage: null,
  category: null, area: null, note: null, photos: [], deletedAt: null,
};
const compartment = {
  id: 'compartment-1', labelNumber: 42, stockQuantity: 7,
  inventoryItem: item,
  drawer: { drawerNumber: 3, shelf: { area: '現場', shelfNumber: 2 } },
  itemTag: { id: 'tag-1', uid: 'item-uid', kind: 'ITEM', quantity: null },
};

async function request(url: string, headers: Record<string, string> = { 'x-client-key': 'kiosk-key' }) {
  const app = Fastify();
  registerErrorHandler(app);
  registerItemInventoryRoutes(app);
  try {
    return await app.inject({ method: 'GET', url, headers });
  } finally {
    await app.close();
  }
}

describe('inventory compartment label lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clientDevice.findUnique.mockImplementation(async ({ where }: { where: { apiKey: string } }) =>
      where.apiKey === 'kiosk-key' ? { id: 'terminal-1' } : null);
    db.inventoryCompartment.findUnique.mockResolvedValue(compartment);
    db.inventoryNfcTag.findUnique.mockResolvedValue({ ...compartment.itemTag, compartment });
  });

  it.each(['42', '0042'])('returns the same item and response as tag lookup for %s', async (number) => {
    const response = await request(`/item-inventory/compartments/by-label/${number}`);
    const tagResponse = await request('/item-inventory/tags/resolve?uid=item-uid');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(tagResponse.json());
    expect(response.json().tag.compartment).toMatchObject({ labelNumber: 42, item: { id: item.id, name: item.name } });
    expect(db.inventoryCompartment.findUnique).toHaveBeenCalledWith({
      where: { labelNumber: 42 },
      include: expect.objectContaining({ inventoryItem: { include: { photos: { orderBy: [{ photoIndex: 'asc' }, { createdAt: 'asc' }] } } } }),
    });
  });

  it('opens a compartment even when its item tag is detached', async () => {
    db.inventoryCompartment.findUnique.mockResolvedValue({ ...compartment, itemTag: null });
    const response = await request('/item-inventory/compartments/by-label/42');
    expect(response.statusCode).toBe(200);
    expect(response.json().tag).toMatchObject({
      id: compartment.id, uid: '', kind: 'ITEM', quantity: null,
      compartment: { labelNumber: 42, itemTagUid: null, item: { id: item.id } },
    });
  });

  it('returns 404 for an unknown number', async () => {
    db.inventoryCompartment.findUnique.mockResolvedValue(null);
    expect((await request('/item-inventory/compartments/by-label/999')).statusCode).toBe(404);
  });

  it('returns 404 for a soft-deleted item', async () => {
    db.inventoryCompartment.findUnique.mockResolvedValue({ ...compartment, inventoryItem: { ...item, deletedAt: new Date() } });
    expect((await request('/item-inventory/compartments/by-label/42')).statusCode).toBe(404);
  });

  it.each(['abc', '0', '-1', '1.5', '1e2', '0x10', '+1', '2147483648', '999999999999999999999'])('rejects invalid number %s', async (number) => {
    const response = await request(`/item-inventory/compartments/by-label/${number}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe('VALIDATION_ERROR');
    expect(db.inventoryCompartment.findUnique).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{}, { 'x-client-key': 'wrong' }])('requires the existing read authorization: %j', async (headers) => {
    expect((await request('/item-inventory/compartments/by-label/42', headers)).statusCode).toBe(401);
    expect(db.inventoryCompartment.findUnique).not.toHaveBeenCalled();
  });
});
