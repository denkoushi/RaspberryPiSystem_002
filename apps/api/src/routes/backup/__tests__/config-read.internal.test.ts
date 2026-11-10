import { trustImmediateProxy } from '../../../lib/trust-proxy.js';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkHealth: vi.fn(),
}));

vi.mock('../../../services/backup/backup-config.loader.js', () => ({
  BackupConfigLoader: { checkHealth: mocks.checkHealth },
}));

import { registerErrorHandler } from '../../../plugins/error-handler.js';
import { registerBackupConfigReadRoutes } from '../config-read.js';

describe('GET /api/backup/config/health/internal', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.checkHealth.mockResolvedValue({ status: 'healthy', issues: [] });
    app = Fastify({ trustProxy: trustImmediateProxy });
    registerErrorHandler(app);
    await app.register(registerBackupConfigReadRoutes, { prefix: '/api' });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['127.0.0.1', '::1'])('allows loopback callers (%s)', async (remoteAddress) => {
    const response = await app.inject({ method: 'GET', url: '/api/backup/config/health/internal', remoteAddress });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a spoofed loopback forwarded header before checking health', async () => {
    const response = await app.inject({
      method: 'GET', url: '/api/backup/config/health/internal', remoteAddress: '172.18.0.5',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.checkHealth).not.toHaveBeenCalled();
  });

  it.each(['172.18.0.5', '172.20.0.1', '192.168.1.10'])(
    'rejects Docker bridge and LAN callers such as the reverse proxy (%s)',
    async (remoteAddress) => {
      const response = await app.inject({ method: 'GET', url: '/api/backup/config/health/internal', remoteAddress });
      expect(response.statusCode).toBe(403);
      expect(mocks.checkHealth).not.toHaveBeenCalled();
    }
  );
});
