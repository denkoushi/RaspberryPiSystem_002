import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createProxyServer, isAllowedConnect } from './proxy.mjs';

test('allows only the OpenAI TLS endpoint', () => {
  assert.equal(isAllowedConnect('api.openai.com:443'), true);
  assert.equal(isAllowedConnect('API.OPENAI.COM:443'), true);
  assert.equal(isAllowedConnect('api.openai.com:80'), false);
  assert.equal(isAllowedConnect('example.com:443'), false);
  assert.equal(isAllowedConnect('api.openai.com:443/path'), false);
  assert.equal(isAllowedConnect('api.openai.com'), false);
});

test('relays an allowed CONNECT tunnel with real sockets', async (t) => {
  const upstream = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const proxy = createProxyServer({ allowedHost: '127.0.0.1', allowedPort: String(upstreamPort) });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;
  t.after(() => proxy.close());
  t.after(() => upstream.close());

  const client = net.createConnection(proxyPort, '127.0.0.1');
  t.after(() => client.destroy());
  const chunks = [];
  await new Promise((resolve, reject) => {
    client.once('error', reject);
    client.once('data', (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).includes(Buffer.from('\r\n\r\n'))) resolve();
    });
    client.write(
      'CONNECT 127.0.0.1:' + upstreamPort +
      ' HTTP/1.1\r\nHost: 127.0.0.1:' + upstreamPort + '\r\n\r\n'
    );
  });
  assert.match(Buffer.concat(chunks).toString(), /^HTTP\/1\.1 200 Connection Established\r\n\r\n/);

  const echoed = new Promise((resolve, reject) => {
    client.once('error', reject);
    client.once('data', (chunk) => resolve(chunk.toString()));
  });
  client.write('test-payload');
  assert.equal(await echoed, 'test-payload');
});
