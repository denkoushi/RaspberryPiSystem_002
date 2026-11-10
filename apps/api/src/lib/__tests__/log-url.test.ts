import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { redactUrlForLog, serializeRequestForLog } from '../log-url.js';

describe('redactUrlForLog', () => {
  it('redacts credential query values and keeps the rest', () => {
    expect(redactUrlForLog('/api/signage/current-image?key=device-secret&t=1')).toBe(
      '/api/signage/current-image?key=[REDACTED]&t=1'
    );
    expect(redactUrlForLog('/api/webrtc/signaling?clientKey=device-secret')).toBe(
      '/api/webrtc/signaling?clientKey=[REDACTED]'
    );
    expect(redactUrlForLog('/api/x?TOKEN=a&%63ode=b&page=2')).toBe('/api/x?TOKEN=[REDACTED]&%63ode=[REDACTED]&page=2');
  });

  it('leaves URLs without credential parameters unchanged', () => {
    expect(redactUrlForLog('/api/tools/items?page=2')).toBe('/api/tools/items?page=2');
    expect(redactUrlForLog('/api/system/health')).toBe('/api/system/health');
  });
});

describe('serializeRequestForLog', () => {
  it('keeps the device key out of Fastify request logs', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = Fastify({ logger: { level: 'info', stream, serializers: { req: serializeRequestForLog } } });
    app.get('/api/signage/current-image', async () => ({ ok: true }));
    try {
      await app.inject({ method: 'GET', url: '/api/signage/current-image?key=device-secret-value' });
      const output = lines.join('');
      expect(output).toContain('/api/signage/current-image?key=[REDACTED]');
      expect(output).not.toContain('device-secret-value');
    } finally {
      await app.close();
    }
  });
});
