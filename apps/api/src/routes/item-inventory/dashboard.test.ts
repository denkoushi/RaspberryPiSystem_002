import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, inventory, verify } = vi.hoisted(() => ({
  db: { clientDevice: { findUnique: vi.fn() }, inventoryImportPhoto: { findFirst: vi.fn() }, inventoryItemPhoto: { findFirst: vi.fn() } },
  inventory: { dashboard: vi.fn(), toolValueVariants: vi.fn(), mergeToolValueVariants: vi.fn(), dismissToolValueVariants: vi.fn(), updateItemDetails: vi.fn() }, verify: vi.fn(),
}));
vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../../services/item-inventory/item-inventory-service.factory.js', () => ({ getItemInventoryServices: () => ({ inventory }) }));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({ SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared', verifyDueManagementAccessPassword: verify }));

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { registerItemInventoryRoutes } from './index.js';


const headers = { 'x-client-key': 'kiosk-key', 'x-kiosk-access-password': '2520' };
async function request(url: string, payload?: object, credentials: Record<string, string> = headers) {
  const app = Fastify();
  registerErrorHandler(app);
  registerItemInventoryRoutes(app);
  try { return await app.inject({ method: payload ? (url.endsWith('/details') ? 'PUT' : 'POST') : 'GET', url: `/item-inventory/${url}`, payload, headers: credentials }); }
  finally { await app.close(); }
}
describe('inventory dashboard and variant routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.clientDevice.findUnique.mockImplementation(async ({ where }: { where: { apiKey: string } }) => where.apiKey === 'kiosk-key' ? { id: 'terminal' } : null);
    verify.mockImplementation(async ({ password }: { password: string }) => ({ success: password === '2520' }));
    inventory.dashboard.mockResolvedValue({ weeks: [], totalIssued: 0 });
    inventory.toolValueVariants.mockResolvedValue({ groups: [], autoMergedValueCount: 2 });
  });
  it.each(['dashboard', 'tool-value-variants', 'tool-value-variants/merge', 'tool-value-variants/dismiss'])('protects %s with setup authorization', async url => {
    const payload = url.endsWith('merge') ? { field: 'maker', to: 'OSG', from: ['osg'] } : url.endsWith('dismiss') ? { field: 'maker', values: ['OSG', 'osg'] } : undefined;
    expect((await request(url, payload, {})).statusCode).toBe(401);
    expect((await request(url, payload, { 'x-client-key': 'kiosk-key' })).statusCode).toBe(401);
    expect((await request(url, payload, { ...headers, 'x-kiosk-access-password': '9999' })).statusCode).toBe(403);
    for (const method of Object.values(inventory)) expect(method).not.toHaveBeenCalled();
  });
  it.each([4, 12, 26, 52])('passes period %s and machine', async weeks => {
    const response = await request(`dashboard?weeks=${weeks}&machine=A`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ weeks: [], totalIssued: 0 });
    expect(inventory.dashboard).toHaveBeenCalledWith(weeks, 'A');
  });
  it('defaults period and rejects invalid query', async () => {
    expect((await request('dashboard')).statusCode).toBe(200);
    expect(inventory.dashboard).toHaveBeenCalledWith(12, undefined);
    expect((await request('dashboard?weeks=5')).statusCode).toBe(400);
    expect((await request('dashboard?machine=')).statusCode).toBe(400);
  });
  it('returns variants and dispatches merge and dismissal', async () => {
    expect((await request('tool-value-variants')).json()).toEqual({ groups: [], autoMergedValueCount: 2 });
    expect((await request('tool-value-variants/merge', { field: 'maker', to: 'OSG', from: ['オーエスジー'] })).statusCode).toBe(200);
    expect(inventory.mergeToolValueVariants).toHaveBeenCalledWith('maker', 'OSG', ['オーエスジー']);
    expect((await request('tool-value-variants/dismiss', { field: 'toolName', values: ['リーマ', 'リーマー'] })).statusCode).toBe(200);
    expect(inventory.dismissToolValueVariants).toHaveBeenCalledWith('toolName', ['リーマ', 'リーマー']);
  });
  it('validates variant fields, values and prices', async () => {
    for (const body of [{ field: 'name', to: 'A', from: ['B'] }, { field: 'maker', to: ' ', from: ['B'] }, { field: 'maker', to: 'A', from: [] }]) expect((await request('tool-value-variants/merge', body)).statusCode).toBe(400);
    expect((await request('tool-value-variants/dismiss', { field: 'maker', values: ['A'] })).statusCode).toBe(400);
    const url = 'items/00000000-0000-4000-8000-000000000001/details';
    for (const unitPrice of [-1, 1.5, 10000001, '1']) expect((await request(url, { unitPrice })).statusCode).toBe(400);
    for (const unitPrice of [null, 0, 10000000]) expect((await request(url, { unitPrice })).statusCode).toBe(200);
    expect(inventory.updateItemDetails).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000001', { unitPrice: 10000000 });
  });
});
