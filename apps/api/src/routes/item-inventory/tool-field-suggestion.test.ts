import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, suggest, verify } = vi.hoisted(() => ({
  db: { clientDevice: { findUnique: vi.fn() }, inventoryImportPhoto: { findFirst: vi.fn() }, inventoryItemPhoto: { findFirst: vi.fn() } },
  suggest: vi.fn(), verify: vi.fn(),
}));
vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', () => ({ getItemInventoryServices: () => ({}) }));
vi.mock('../../services/item-inventory/tool-field-suggestion.service.js', () => ({ ToolFieldSuggestionService: class { suggest = suggest; } }));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({ SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared', verifyDueManagementAccessPassword: verify }));

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerItemInventoryRoutes } from './index.js';

const id = '00000000-0000-4000-8000-000000000001';
const body = { source: 'import', payloadId: id, photoId: id };
const headers = { 'x-client-key': 'kiosk-key', 'x-kiosk-access-password': '2520' };
async function post(payload: object, credentials: Record<string, string> = headers) {
  const app = Fastify();
  registerErrorHandler(app);
  registerItemInventoryRoutes(app);
  try { return await app.inject({ method: 'POST', url: '/item-inventory/import-photos/suggest-tool-fields', payload, headers: credentials }); }
  finally { await app.close(); }
}

describe('inventory photo suggestion route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clientDevice.findUnique.mockImplementation(async ({ where }: { where: { apiKey: string } }) => where.apiKey === 'kiosk-key' ? { id: 'terminal' } : null);
    verify.mockImplementation(async ({ password }: { password: string }) => ({ success: password === '2520' }));
    db.inventoryImportPhoto.findFirst.mockResolvedValue({ photoUrl: '/api/storage/photos/import.jpg' });
    db.inventoryItemPhoto.findFirst.mockResolvedValue({ photoUrl: '/api/storage/photos/item.jpg' });
    suggest.mockResolvedValue({ model: ['M1'], maker: ['OSG'], status: 'ok' });
  });

  it('requires setup credentials and does not run inference on denied requests', async () => {
    expect((await post(body, {})).statusCode).toBe(401);
    expect((await post(body, { 'x-client-key': 'kiosk-key' })).statusCode).toBe(401);
    expect((await post(body, { ...headers, 'x-client-key': 'wrong' })).statusCode).toBe(401);
    expect((await post(body, { ...headers, 'x-kiosk-access-password': '9999' })).statusCode).toBe(403);
    expect(suggest).not.toHaveBeenCalled();
  });

  it.each([{}, { ...body, photoId: 'bad' }, { ...body, payloadId: 'bad' }, { ...body, photoUrl: '/arbitrary' }, { source: 'item', photoId: id }])('validates the photo identity: %j', async payload => {
    expect((await post(payload)).statusCode).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('looks up the import photo within the payload and returns candidates', async () => {
    const response = await post(body);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ model: ['M1'], maker: ['OSG'], status: 'ok' });
    expect(db.inventoryImportPhoto.findFirst).toHaveBeenCalledWith({ where: { id, payloadId: id }, select: { photoUrl: true } });
    expect(suggest).toHaveBeenCalledWith('/api/storage/photos/import.jpg', expect.any(AbortSignal));
  });

  it('supports registered item photos and fail-soft results', async () => {
    suggest.mockResolvedValue({ model: [], maker: [], status: 'unavailable' });
    const response = await post({ source: 'item', itemId: id, photoId: id });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ model: [], maker: [], status: 'unavailable' });
    expect(db.inventoryItemPhoto.findFirst).toHaveBeenCalledWith({ where: { id, inventoryItemId: id, inventoryItem: { deletedAt: null } }, select: { photoUrl: true } });
  });

  it('returns 404 for a photo outside the payload', async () => {
    db.inventoryImportPhoto.findFirst.mockResolvedValue(null);
    expect((await post(body)).statusCode).toBe(404);
    expect(suggest).not.toHaveBeenCalled();
  });
});
