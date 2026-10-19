import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../plugins/error-handler.js';
import { BackupConfigLoader } from '../../services/backup/backup-config.loader.js';
import { defaultBackupConfig } from '../../services/backup/backup-config.js';
import { DropboxOAuthService } from '../../services/backup/dropbox-oauth.service.js';
import { GmailOAuthService } from '../../services/backup/gmail-oauth.service.js';
import * as oauthStateStore from '../../services/oauth-state.store.js';
import { registerBackupOAuthRoutes } from '../backup/oauth.js';
import { registerGmailOAuthRoutes } from '../gmail/oauth.js';

vi.mock('../../config/env.js', () => ({
  env: { NODE_ENV: 'test', JWT_ACCESS_SECRET: 'oauth-test-access-secret' }
}));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock('../../services/backup/backup-config.loader.js', () => ({
  BackupConfigLoader: { load: vi.fn(), save: vi.fn() }
}));

const headersFor = (role: string) => ({
  authorization: `Bearer ${jwt.sign(
    { sub: 'admin-id', username: 'admin', role }, 'oauth-test-access-secret'
  )}`
});

describe.each([
  { provider: 'dropbox', path: '/backup/oauth', otherPath: '/gmail/oauth' },
  { provider: 'gmail', path: '/gmail/oauth', otherPath: '/backup/oauth' }
] as const)('$provider OAuth state validation', ({ provider, path, otherPath }) => {
  let app: FastifyInstance;
  let now: number;

  beforeEach(async () => {
    now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(oauthStateStore, 'issueOAuthState');
    vi.mocked(BackupConfigLoader.load).mockResolvedValue({
      ...defaultBackupConfig,
      storage: {
        provider: 'local',
        options: {
          appKey: 'dropbox-key', appSecret: 'dropbox-secret',
          gmail: { clientId: 'gmail-id', clientSecret: 'gmail-secret' }
        }
      },
      targets: [], retention: { days: 30, maxItems: 100 }
    });
    vi.mocked(BackupConfigLoader.save).mockResolvedValue(undefined);
    const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token', tokenType: 'Bearer' };
    vi.spyOn(DropboxOAuthService.prototype, 'exchangeCodeForTokens').mockResolvedValue(tokens);
    vi.spyOn(GmailOAuthService.prototype, 'exchangeCodeForTokens').mockResolvedValue(tokens);
    app = Fastify();
    registerErrorHandler(app);
    await registerBackupOAuthRoutes(app);
    registerGmailOAuthRoutes(app);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function authorize(route = path): Promise<string> {
    const response = await app.inject({ url: `${route}/authorize`, headers: headersFor('ADMIN') });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ state: string; authorizationUrl: string }>();
    expect(new URL(body.authorizationUrl).searchParams.get('state')).toBe(body.state);
    return body.state;
  }

  function callback(query: Record<string, string>) {
    return app.inject({ url: `${path}/callback?${new URLSearchParams(query)}` });
  }

  function expectNoExchangeOrSave() {
    expect(DropboxOAuthService.prototype.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(GmailOAuthService.prototype.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(BackupConfigLoader.save).not.toHaveBeenCalled();
  }

  it('requires authentication to authorize', async () => {
    const response = await app.inject({ url: `${path}/authorize` });
    expect(response.statusCode).toBe(401);
    expect(oauthStateStore.issueOAuthState).not.toHaveBeenCalled();
  });

  it('requires an administrator to authorize', async () => {
    const response = await app.inject({ url: `${path}/authorize`, headers: headersFor('MANAGER') });
    expect(response.statusCode).toBe(403);
    expect(oauthStateStore.issueOAuthState).not.toHaveBeenCalled();
  });

  it.each([undefined, 'unknown-state'])('rejects missing or unknown state: %s', async (state) => {
    const response = await callback({ code: 'authorization-code', ...(state ? { state } : {}) });
    expect(response.statusCode).toBe(400);
    expect(BackupConfigLoader.load).not.toHaveBeenCalled();
    expectNoExchangeOrSave();
  });

  it('rejects an expired state', async () => {
    const state = await authorize();
    vi.mocked(BackupConfigLoader.load).mockClear();
    now += 600_000;
    expect((await callback({ code: 'authorization-code', state })).statusCode).toBe(400);
    expect(BackupConfigLoader.load).not.toHaveBeenCalled();
    expectNoExchangeOrSave();
  });

  it('rejects and consumes a state for another provider', async () => {
    const state = await authorize(otherPath);
    expect((await callback({ code: 'authorization-code', state })).statusCode).toBe(400);
    const retry = await app.inject({ url: `${otherPath}/callback?code=authorization-code&state=${state}` });
    expect(retry.statusCode).toBe(400);
    expectNoExchangeOrSave();
  });

  it('completes without a callback JWT and rejects reuse', async () => {
    const state = await authorize();
    expect(oauthStateStore.issueOAuthState).toHaveBeenCalledWith('admin-id', provider);
    const response = await callback({ code: 'authorization-code', state });
    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    const service = provider === 'gmail' ? GmailOAuthService : DropboxOAuthService;
    expect(service.prototype.exchangeCodeForTokens).toHaveBeenCalledExactlyOnceWith('authorization-code');
    expect(BackupConfigLoader.save).toHaveBeenCalledWith(expect.objectContaining({
      storage: expect.objectContaining({
        options: expect.objectContaining({
          [provider]: expect.objectContaining({ accessToken: 'access-token', refreshToken: 'refresh-token' })
        })
      })
    }));
    vi.mocked(service.prototype.exchangeCodeForTokens).mockClear();
    vi.mocked(BackupConfigLoader.save).mockClear();
    expect((await callback({ code: 'authorization-code', state })).statusCode).toBe(400);
    expectNoExchangeOrSave();
  });

  it('consumes a state before concurrent callbacks exchange tokens', async () => {
    const state = await authorize();
    const responses = await Promise.all([
      callback({ code: 'authorization-code', state }), callback({ code: 'authorization-code', state })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    const service = provider === 'gmail' ? GmailOAuthService : DropboxOAuthService;
    expect(service.prototype.exchangeCodeForTokens).toHaveBeenCalledTimes(1);
    expect(BackupConfigLoader.save).toHaveBeenCalledTimes(1);
  });

  it.each<Record<string, string>>([
    { error: 'access_denied' },
    {},
    { code: '' }
  ])('consumes state on an unsuccessful callback: %j', async (query) => {
    const state = await authorize();
    expect((await callback({ ...query, state })).statusCode).toBe(400);
    expect((await callback({ code: 'authorization-code', state })).statusCode).toBe(400);
    expectNoExchangeOrSave();
  });

  it.each(['exchange', 'save', 'load'] as const)('consumes state on %s failure', async (failure) => {
    const state = await authorize();
    const service = provider === 'gmail' ? GmailOAuthService : DropboxOAuthService;
    if (failure === 'exchange') {
      vi.mocked(service.prototype.exchangeCodeForTokens).mockRejectedValueOnce(new Error('Token exchange failed'));
    } else if (failure === 'save') {
      vi.mocked(BackupConfigLoader.save).mockRejectedValueOnce(new Error('Config save failed'));
    } else {
      vi.mocked(BackupConfigLoader.load).mockRejectedValueOnce(new Error('Config load failed'));
    }
    expect((await callback({ code: 'authorization-code', state })).statusCode).toBe(500);
    vi.mocked(service.prototype.exchangeCodeForTokens).mockClear();
    vi.mocked(BackupConfigLoader.save).mockClear();
    expect((await callback({ code: 'authorization-code', state })).statusCode).toBe(400);
    expectNoExchangeOrSave();
  });
});
