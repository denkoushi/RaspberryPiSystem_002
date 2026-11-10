import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dropbox } from 'dropbox';
import * as https from 'https';
import fetch from 'node-fetch';
import type { RequestInit } from 'node-fetch';
import { DropboxStorageProvider } from '../storage/dropbox-storage.provider.js';
import type { DropboxOAuthService } from '../dropbox-oauth.service.js';

vi.mock('dropbox', () => ({ Dropbox: vi.fn() }));
vi.mock('node-fetch', () => ({ default: vi.fn() }));

describe('DropboxStorageProvider - TLS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockRejectedValue(new Error('Unexpected network request'));
  });

  it('uses standard TLS verification before and after token refresh', async () => {
    const agents: https.Agent[] = [];
    const request = vi.fn()
      .mockRejectedValueOnce({ status: 401 })
      .mockResolvedValueOnce(undefined);
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const agent = init?.agent;
      expect(agent).toBeInstanceOf(https.Agent);
      agents.push(agent as https.Agent);
      await request();
      return {} as Awaited<ReturnType<typeof fetch>>;
    });

    vi.mocked(Dropbox).mockImplementation(function (options) {
      return {
        filesUpload: () => (options.fetch as (url: string, init?: RequestInit) => Promise<unknown>)(
          'https://content.dropboxapi.com/2/files/upload',
          { method: 'POST' }
        )
      } as unknown as Dropbox;
    });
    const refreshAccessToken = vi.fn().mockResolvedValue({ accessToken: 'refreshed-token' });
    const provider = new DropboxStorageProvider({
      accessToken: 'initial-token',
      refreshToken: 'refresh-token',
      oauthService: { refreshAccessToken } as unknown as DropboxOAuthService
    });

    await provider.upload(Buffer.from('encrypted-backup'), 'backup.enc');

    expect(refreshAccessToken).toHaveBeenCalledWith('refresh-token');
    expect(Dropbox).toHaveBeenCalledTimes(2);
    expect(Dropbox).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'refreshed-token' }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(agents).toHaveLength(2);
    expect(agents[1]).not.toBe(agents[0]);
    for (const agent of agents) {
      expect(agent.options.rejectUnauthorized).toBe(true);
      expect(agent.options.minVersion).toBe('TLSv1.2');
      expect(agent.options.secureProtocol).toBeUndefined();
      expect(agent.options.checkServerIdentity).toBeUndefined();
      expect(agent.options.keepAlive).toBe(true);
      expect(agent.options.keepAliveMsecs).toBe(1000);
      expect(agent.options.maxSockets).toBe(5);
      expect(agent.options.timeout).toBe(30000);
      agent.destroy();
    }
  });
});
