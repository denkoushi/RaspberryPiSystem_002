import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/errors.js';
import { deleteHaizenCurrentPlacement } from '../../services/mobile-placement/haizen-placement.service.js';
import { deleteOrderPlacementBranch } from '../../services/mobile-placement/order-placement-branch.service.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { registerMobilePlacementRoutes } from '../mobile-placement/index.js';

vi.mock('../../config/env/load-dotenv.js', () => ({}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: vi.fn() }));
vi.mock('../../services/mobile-placement/order-placement-branch.service.js', () => ({
  deleteOrderPlacementBranch: vi.fn(), listOrderPlacementBranches: vi.fn(), moveOrderPlacementBranch: vi.fn()
}));

vi.mock('../../services/mobile-placement/haizen-placement.service.js', () => ({ deleteHaizenCurrentPlacement: vi.fn() }));

let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireClientDevice).mockResolvedValue({ clientDevice: { id: 'device' } } as never);
  app = Fastify();
  await registerMobilePlacementRoutes(app);
});
afterEach(async () => { await app.close(); });

describe('DELETE /mobile-placement/order-placement-branches/:id', () => {
  it('authenticates the client and returns the deleted branch', async () => {
    const deleted = { id: 'branch', manufacturingOrderBarcodeRaw: '100', branchNo: 3, shelfCodeRaw: 'A' };
    vi.mocked(deleteOrderPlacementBranch).mockResolvedValue(deleted);
    const response = await app.inject({ method: 'DELETE', url: '/mobile-placement/order-placement-branches/branch', headers: { 'x-client-key': 'test-key' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted });
    expect(requireClientDevice).toHaveBeenCalledExactlyOnceWith('test-key');
    expect(deleteOrderPlacementBranch).toHaveBeenCalledExactlyOnceWith('branch');
  });
  it('returns 404 when the branch no longer exists', async () => {
    vi.mocked(deleteOrderPlacementBranch).mockRejectedValue(new ApiError(404, 'この品物はもうありません'));
    const response = await app.inject({ method: 'DELETE', url: '/mobile-placement/order-placement-branches/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe('この品物はもうありません');
  });
  it.each(['', '%20'])('returns 400 for an empty id (%s)', async id => {
    const response = await app.inject({ method: 'DELETE', url: `/mobile-placement/order-placement-branches/${id}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('分配枝IDが必要です');
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
  });
  it('does not delete without client authentication', async () => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    const response = await app.inject({ method: 'DELETE', url: '/mobile-placement/order-placement-branches/branch' });
    expect(response.statusCode).toBe(401);
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
  });
});

describe('DELETE /mobile-placement/haizen-current/:id', () => {
  it('authenticates the client and deletes the identified Zero2W placement', async () => {
    const deleted = { id: 'current', manufacturingOrderBarcodeRaw: '100', shelfCodeRaw: 'A' };
    vi.mocked(deleteHaizenCurrentPlacement).mockResolvedValue(deleted);
    const response = await app.inject({ method: 'DELETE', url: '/mobile-placement/haizen-current/current', headers: { 'x-client-key': 'test-key' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted });
    expect(requireClientDevice).toHaveBeenCalledExactlyOnceWith('test-key');
    expect(deleteHaizenCurrentPlacement).toHaveBeenCalledExactlyOnceWith('current');
    expect(deleteOrderPlacementBranch).not.toHaveBeenCalled();
  });
  it('returns the existing 404 message for a missing placement', async () => {
    vi.mocked(deleteHaizenCurrentPlacement).mockRejectedValue(new ApiError(404, 'この品物はもうありません'));
    const response = await app.inject({ method: 'DELETE', url: '/mobile-placement/haizen-current/missing' });
    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe('この品物はもうありません');
  });
  it.each(['', '%20'])('rejects an empty id (%s)', async id => {
    const response = await app.inject({ method: 'DELETE', url: `/mobile-placement/haizen-current/${id}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe('配膳記録IDが必要です');
    expect(deleteHaizenCurrentPlacement).not.toHaveBeenCalled();
  });
  it('does not delete without client authentication', async () => {
    vi.mocked(requireClientDevice).mockRejectedValue(new ApiError(401, 'unauthorized'));
    const response = await app.inject({ method: 'DELETE', url: '/mobile-placement/haizen-current/current' });
    expect(response.statusCode).toBe(401);
    expect(deleteHaizenCurrentPlacement).not.toHaveBeenCalled();
  });
});
