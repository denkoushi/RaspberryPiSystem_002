import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findClientDeviceByApiKey = vi.fn();
vi.mock('../../../services/clients/client-device-auth.service.js', () => ({
  findClientDeviceByApiKey: (key: string) => findClientDeviceByApiKey(key),
}));

import { registerContentRoute } from '../content.js';

const content = {
  contentType: 'TOOLS',
  displayMode: 'SINGLE',
  tools: [{ id: 't1', itemCode: 'T-1', name: 'ノギス', employeeName: '山田', thumbnailUrl: '/storage/thumbnails/tool.jpg' }],
};

function createApp() {
  const getContent = vi.fn().mockResolvedValue(content);
  const app = Fastify();
  registerContentRoute(app, { getContent } as never);
  return { app, getContent };
}

describe('GET /content', () => {
  beforeEach(() => findClientDeviceByApiKey.mockReset());

  it('returns borrower names to a registered terminal key', async () => {
    findClientDeviceByApiKey.mockResolvedValue({ id: 'device-1' });
    const { app, getContent } = createApp();
    const res = await app.inject({ url: '/content', headers: { 'x-client-key': 'signage-1' } });
    expect(res.json().tools[0]).toMatchObject({ employeeName: '山田', thumbnailUrl: '/storage/thumbnails/tool.jpg' });
    expect(getContent).toHaveBeenCalledWith({ clientKey: 'signage-1' });
    await app.close();
  });

  it('hides borrower names without a key', async () => {
    const { app, getContent } = createApp();
    const res = await app.inject({ url: '/content' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools[0]).toMatchObject({ name: 'ノギス', employeeName: null, thumbnailUrl: null });
    expect(getContent).toHaveBeenCalledWith({ clientKey: null });
    expect(findClientDeviceByApiKey).not.toHaveBeenCalled();
    await app.close();
  });

  it('hides borrower names for an unknown key', async () => {
    findClientDeviceByApiKey.mockResolvedValue(null);
    const { app, getContent } = createApp();
    const res = await app.inject({ url: '/content?clientKey=unknown' });
    expect(res.json().tools[0]).toMatchObject({ employeeName: null, thumbnailUrl: null });
    expect(getContent).toHaveBeenCalledWith({ clientKey: null });
    await app.close();
  });
});
