import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import { deleteOrderPlacementBranch } from './mobile-placement';

vi.mock('../http', () => ({ api: { delete: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

describe('deleteOrderPlacementBranch', () => {
  it('sends the observed version as a query parameter', async () => {
    const expectedUpdatedAt = '2026-10-28T00:00:00.000Z';
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: { id: 'branch' } } });
    await deleteOrderPlacementBranch('branch', expectedUpdatedAt);
    expect(api.delete).toHaveBeenCalledExactlyOnceWith('/mobile-placement/order-placement-branches/branch', {
      params: { expectedUpdatedAt }
    });
  });
  it('keeps direct online deletes without a version working', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { deleted: { id: 'branch' } } });
    await expect(deleteOrderPlacementBranch('branch')).resolves.toEqual({ deleted: { id: 'branch' } });
    expect(api.delete).toHaveBeenCalledExactlyOnceWith('/mobile-placement/order-placement-branches/branch', undefined);
  });
});
