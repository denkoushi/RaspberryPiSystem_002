import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../http';

import { sendBusinessHermesChat } from './assembly';

vi.mock('../http', () => ({
  api: { post: vi.fn() }
}));

const apiPost = vi.mocked(api.post);

describe('assembly Business Hermes API client', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ data: { status: 'unavailable' } } as never);
  });

  it('allows a chat route to wait up to 600s while preserving cancellation', async () => {
    const controller = new AbortController();
    const payload = { messages: [{ role: 'user' as const, content: '品番 PART-1 の不適合' }] };

    await expect(sendBusinessHermesChat(payload, controller.signal)).resolves.toEqual({ status: 'unavailable' });
    expect(apiPost).toHaveBeenCalledWith('/assembly/business-hermes/chat', payload, {
      signal: controller.signal,
      timeout: 600_000
    });
  });
});
