import Fastify from 'fastify';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { registerKioskPowerRoute } from '../power.js';

it('writes power action metadata without a client key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kiosk-power-'));
  const app = Fastify({ genReqId: () => 'power-request' });
  try {
    await registerKioskPowerRoute(app, {
      requireClientDevice: async () => ({ clientKey: 'test-client-key', clientDevice: { id: 'device-1' } }),
      checkPowerRateLimit: async () => true,
      powerActionsDir: directory,
    });
    const response = await app.inject({ method: 'POST', url: '/kiosk/power', payload: { action: 'reboot' } });
    expect(response.statusCode).toBe(200);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const contents = JSON.parse(await readFile(join(directory, files[0]!), 'utf8'));
    expect(contents).toEqual({
      clientDeviceId: 'device-1', action: 'reboot', requestId: 'power-request', requestedAt: expect.any(String),
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
