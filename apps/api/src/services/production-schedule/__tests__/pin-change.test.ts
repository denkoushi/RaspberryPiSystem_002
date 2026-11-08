import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), hash: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { productionScheduleAccessPasswordConfig: { upsert: mocks.upsert } } }));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));
import { upsertDueManagementAccessPassword } from '../production-schedule-settings.service.js';

beforeEach(() => { vi.clearAllMocks(); mocks.hash.mockResolvedValue('hashed-pin'); });
describe('operation PIN changes', () => {
  it('stores the change time with both newly configured and updated PINs', async () => {
    const before = Date.now();
    await expect(upsertDueManagementAccessPassword({ location: 'shared', password: ' 1234 ' })).resolves.toMatchObject({ configured: true });
    expect(mocks.hash).toHaveBeenCalledWith('1234', 10);
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.create).toMatchObject({ location: 'shared', dueManagementPasswordHash: 'hashed-pin', passwordChangedAt: expect.any(Date) });
    expect(args.update).toEqual({ dueManagementPasswordHash: 'hashed-pin', passwordChangedAt: args.create.passwordChangedAt });
    expect(args.create.passwordChangedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
  it('continues to reject empty PINs without writing', async () => {
    await expect(upsertDueManagementAccessPassword({ location: 'shared', password: '  ' })).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
