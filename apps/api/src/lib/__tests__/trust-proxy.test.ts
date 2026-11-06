import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { trustImmediateProxy } from '../trust-proxy.js';
import { serializeRequestForLog } from '../log-url.js';

describe('API proxy trust boundary', () => {
  it.each([
    [undefined, '172.18.0.2', ['172.18.0.2']],
    ['192.0.2.10', '192.0.2.10', ['172.18.0.2', '192.0.2.10']],
    ['198.51.100.99, 192.0.2.10', '192.0.2.10', ['172.18.0.2', '192.0.2.10']],
  ])('uses only the last forwarded IP (%s)', async (forwardedFor, ip, ips) => {
    const app = Fastify({ trustProxy: trustImmediateProxy });
    app.get('/', async (request) => ({
      ip: request.ip, ips: request.ips, peer: request.socket.remoteAddress,
      loggedIp: serializeRequestForLog(request).remoteAddress,
    }));
    try {
      const response = await app.inject({
        url: '/', remoteAddress: '172.18.0.2',
        headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
      });
      expect(response.json()).toEqual({ ip, ips, peer: '172.18.0.2', loggedIp: ip });
    } finally {
      await app.close();
    }
  });

  it('uses forwarded Host/Proto while keeping the original Host header', async () => {
    const app = Fastify({ trustProxy: trustImmediateProxy });
    app.get('/', async (request) => ({
      hostname: request.hostname, protocol: request.protocol, host: request.headers.host,
    }));
    try {
      const response = await app.inject({
        url: '/', headers: {
          host: 'api:8080', 'x-forwarded-host': 'factory.example', 'x-forwarded-proto': 'https',
        },
      });
      expect(response.json()).toEqual({ hostname: 'factory.example', protocol: 'https', host: 'api:8080' });
    } finally {
      await app.close();
    }
  });
});
