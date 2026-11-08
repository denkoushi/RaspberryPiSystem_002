import { describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn(async () => ({ data: { user: { id: 'u1' } } })));
vi.mock('../http', () => ({ api: { post } }));
import { logoutRequest, updateUserRole } from './auth';
describe('admin auth API', () => {
  it('sends the acting user password when changing a role', async () => {
    await updateUserRole('u1', 'MANAGER', 'confirmation');
    expect(post).toHaveBeenCalledWith('/auth/users/u1/role', { role: 'MANAGER', currentPassword: 'confirmation' });
  });
  it('calls server logout', async () => {
    await logoutRequest();
    expect(post).toHaveBeenCalledWith('/auth/logout', {});
  });
});
