import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import http from 'node:http';
import { createProxyServer, isAllowedConnect, isAllowedHttpRequest } from './proxy.mjs';

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
  const proxy = createProxyServer({ provider: 'openai', allowedHost: '127.0.0.1', allowedPort: String(upstreamPort) });
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

test('relays the DGX chat path as an absolute-form HTTP request', async (t) => {
  const received = [];
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        url: request.url,
        host: request.headers.host,
        authorization: request.headers.authorization,
        llmToken: request.headers['x-llm-token'],
        body: Buffer.concat(chunks).toString()
      });
      if (chunks.some((chunk) => chunk.toString().includes('redirect'))) {
        response.writeHead(302, { location: 'https://example.invalid/' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = String(upstream.address().port);
  const proxy = createProxyServer({ provider: 'dgx', allowedHttpHost: '127.0.0.1', allowedHttpPort: upstreamPort });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  t.after(() => upstream.close());

  const proxyPort = proxy.address().port;
  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'POST',
      path: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
      headers: {
        Host: `127.0.0.1:${upstreamPort}`,
        Authorization: 'Bearer redacted-token',
        'X-LLM-Token': 'redacted-token',
        'Content-Type': 'application/json'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end('{"model":"system-prod-primary"}');
  });

  assert.deepEqual(response, { status: 200, body: '{"ok":true}' });
  assert.deepEqual(received, [{
    method: 'POST',
    url: '/v1/chat/completions',
    host: `127.0.0.1:${upstreamPort}`,
    authorization: 'Bearer redacted-token',
    llmToken: 'redacted-token',
    body: '{"model":"system-prod-primary"}'
  }]);

  assert.equal(isAllowedHttpRequest({
    method: 'POST',
    url: `http://127.0.0.1:${upstreamPort}/start`,
    headers: { host: `127.0.0.1:${upstreamPort}` }
  }, '127.0.0.1', upstreamPort, '/v1/chat/completions', 'dgx'), false);
  assert.equal(isAllowedHttpRequest({
    method: 'POST',
    url: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
    headers: { host: `127.0.0.1:${upstreamPort}` }
  }, '127.0.0.1', upstreamPort, '/v1/chat/completions', 'dgx'), true);
  assert.equal(isAllowedHttpRequest({
    method: 'POST',
    url: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
    headers: { host: '127.0.0.1:38081' }
  }, '127.0.0.1', upstreamPort, '/v1/chat/completions', 'dgx'), false);
  assert.equal(isAllowedHttpRequest({
    method: 'POST',
    url: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
    headers: { host: `127.0.0.1:${upstreamPort}` }
  }, '127.0.0.1', upstreamPort, '/v1/chat/completions', 'openai'), false);

  const redirectResponse = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'POST',
      path: `http://127.0.0.1:${upstreamPort}/v1/chat/completions`,
      headers: { Host: `127.0.0.1:${upstreamPort}`, 'Content-Type': 'application/json' }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    request.on('error', reject);
    request.end('{"redirect":true}');
  });
  assert.equal(redirectResponse, 502);
});

test('passes the independent egress idle timeout to the DGX upstream request', async (t) => {
  let requestOptions;
  const proxy = createProxyServer({
    provider: 'dgx',
    allowedHttpHost: '127.0.0.1',
    allowedHttpPort: '38081',
    httpRequest: (options) => {
      requestOptions = options;
      const upstream = new EventEmitter();
      upstream.setTimeout = () => {};
      upstream.destroy = () => {};
      upstream.end = () => process.nextTick(() => upstream.emit('error', new Error('test upstream failure')));
      return upstream;
    }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());

  const response = await new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: proxy.address().port,
      method: 'POST',
      path: 'http://127.0.0.1:38081/v1/chat/completions',
      headers: { Host: '127.0.0.1:38081', 'Content-Type': 'application/json' }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    request.on('error', reject);
    request.end('{}');
  });

  assert.equal(response, 502);
  assert.equal(requestOptions.timeout, 60_000);
});

test('uses the former Hermes timeout when the new egress key is absent', () => {
  const childScript = `
    import { EventEmitter } from 'node:events';
    import http from 'node:http';
    import { createProxyServer } from ${JSON.stringify(new URL('./proxy.mjs', import.meta.url).href)};
    let requestOptions;
    const proxy = createProxyServer({
      provider: 'dgx',
      allowedHttpHost: '127.0.0.1',
      allowedHttpPort: '38081',
      httpRequest: (options) => {
        requestOptions = options;
        const upstream = new EventEmitter();
        upstream.setTimeout = () => {};
        upstream.destroy = () => {};
        upstream.end = () => process.nextTick(() => upstream.emit('error', new Error('test')));
        return upstream;
      }
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1',
        port: proxy.address().port,
        method: 'POST',
        path: 'http://127.0.0.1:38081/v1/chat/completions',
        headers: { Host: '127.0.0.1:38081', 'Content-Type': 'application/json' }
      }, (response) => {
        response.resume();
        response.on('end', resolve);
      });
      request.on('error', reject);
      request.end('{}');
    });
    proxy.close();
    if (requestOptions?.timeout !== 8_000) process.exit(1);
  `;
  const environment = { ...process.env, BUSINESS_HERMES_TIMEOUT_MS: '8000' };
  delete environment.BUSINESS_HERMES_EGRESS_TIMEOUT_MS;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', childScript],
    { env: environment, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});
