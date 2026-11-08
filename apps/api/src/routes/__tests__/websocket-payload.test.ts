import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, describe, expect, it } from 'vitest';
import { websocketOptions } from '../../lib/websocket-options.js';

describe('websocket payload boundary', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(apps.map(app => app.close())); apps.length = 0; });

  it('relays a normal signaling payload and closes an oversized message', async () => {
    const app = Fastify();
    apps.push(app);
    await app.register(websocket, websocketOptions);
    app.get('/socket', { websocket: true }, socket => {
      socket.on('error', () => {});
      socket.on('message', message => { socket.send(message); });
    });
    await app.ready();
    const socket = await app.injectWS('/socket');
    const normalMessage = new Promise(resolve => socket.once('message', data => resolve(data.toString())));
    socket.send(JSON.stringify({ type: 'offer', payload: { sdp: 'x'.repeat(32 * 1024) } }));
    expect(await normalMessage).toContain('offer');
    const closed = new Promise(resolve => socket.once('close', code => resolve(code)));
    socket.send('x'.repeat(64 * 1024 + 1));
    expect(await closed).toBe(1009);
  });
});
