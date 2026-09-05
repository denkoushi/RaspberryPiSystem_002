import net from 'node:net';
import http from 'node:http';

const LISTEN_HOST = process.env.LISTEN_HOST ?? '0.0.0.0';
const LISTEN_PORT = Number(process.env.LISTEN_PORT ?? 3128);
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? LISTEN_PORT);
const ALLOWED_HOST = 'api.openai.com';
const DGX_HOST = process.env.DGX_GATEWAY_HOST ?? '100.118.82.72';
const DGX_PORT = process.env.DGX_GATEWAY_PORT ?? '38081';
const DGX_PATH = '/v1/chat/completions';
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const configuredHttpTimeoutMs = Number(process.env.BUSINESS_HERMES_TIMEOUT_MS ?? 8000);
const HTTP_UPSTREAM_TIMEOUT_MS = Number.isInteger(configuredHttpTimeoutMs) && configuredHttpTimeoutMs >= 500 && configuredHttpTimeoutMs <= 30_000
  ? configuredHttpTimeoutMs
  : 8000;
const HTTP_FORWARD_HEADERS = ['content-type', 'authorization', 'x-llm-token', 'accept', 'user-agent'];

export function isAllowedConnect(target, allowedHost = ALLOWED_HOST, allowedPort = '443') {
  if (typeof target !== 'string') return false;
  const separator = target.lastIndexOf(':');
  if (separator <= 0) return false;
  const host = target.slice(0, separator).toLowerCase();
  const port = target.slice(separator + 1);
  return host === allowedHost.toLowerCase() && port === allowedPort;
}

function sameHostHeader(hostHeader, host, port) {
  return typeof hostHeader === 'string' && hostHeader.trim().toLowerCase() === `${host.toLowerCase()}:${port}`;
}

export function isAllowedHttpRequest(request, allowedHost = DGX_HOST, allowedPort = DGX_PORT, allowedPath = DGX_PATH, provider = 'dgx') {
  if (provider !== 'dgx') return false;
  if (!request || request.method !== 'POST' || typeof request.url !== 'string') return false;
  let target;
  try {
    target = new URL(request.url);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' || target.username || target.password) return false;
  if (target.hostname.toLowerCase() !== allowedHost.toLowerCase() || target.port !== String(allowedPort)) return false;
  if (target.pathname !== allowedPath || target.search) return false;
  return sameHostHeader(request.headers?.host, allowedHost, allowedPort);
}

export function createProxyServer({
  connect = net.connect,
  allowedHost = ALLOWED_HOST,
  allowedPort = '443',
  httpRequest = http.request,
  allowedHttpHost = DGX_HOST,
  allowedHttpPort = DGX_PORT,
  allowedHttpPath = DGX_PATH,
  provider = process.env.BUSINESS_HERMES_PROVIDER ?? 'dgx',
  maxHttpBodyBytes = MAX_HTTP_BODY_BYTES,
  httpUpstreamTimeoutMs = HTTP_UPSTREAM_TIMEOUT_MS
} = {}) {
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
      return;
    }
    if (isAllowedHttpRequest(request, allowedHttpHost, allowedHttpPort, allowedHttpPath, provider)) {
      const chunks = [];
      let bodyBytes = 0;
      let rejected = false;
      request.on('data', (chunk) => {
        if (rejected) return;
        bodyBytes += chunk.length;
        if (bodyBytes > maxHttpBodyBytes) {
          rejected = true;
          response.writeHead(413, { connection: 'close' });
          response.end();
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (rejected) return;
        let target;
        try {
          target = new URL(request.url);
        } catch {
          response.writeHead(403);
          response.end();
          return;
        }
        const upstream = httpRequest({
          protocol: 'http:',
          hostname: allowedHttpHost,
          port: Number(allowedHttpPort),
          method: 'POST',
          path: `${target.pathname}${target.search}`,
          headers: Object.fromEntries([
            ...HTTP_FORWARD_HEADERS
              .filter((name) => typeof request.headers[name] === 'string')
              .map((name) => [name, request.headers[name]]),
            ['host', `${allowedHttpHost}:${allowedHttpPort}`],
            ['content-length', String(bodyBytes)],
            ['connection', 'close']
          ]),
          timeout: httpUpstreamTimeoutMs
        }, (upstreamResponse) => {
          if ((upstreamResponse.statusCode ?? 0) >= 300 && (upstreamResponse.statusCode ?? 0) < 400) {
            upstreamResponse.resume();
            response.writeHead(502, { connection: 'close' });
            response.end();
            return;
          }
          const headers = { ...upstreamResponse.headers };
          delete headers.connection;
          delete headers['keep-alive'];
          response.writeHead(upstreamResponse.statusCode ?? 502, headers);
          upstreamResponse.pipe(response);
        });
        upstream.setTimeout(httpUpstreamTimeoutMs, () => upstream.destroy(new Error('upstream timeout')));
        upstream.once('error', () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        response.once('close', () => upstream.destroy());
        upstream.end(Buffer.concat(chunks));
      });
      return;
    }
    response.writeHead(403);
    response.end();
  });

  server.on('connect', (request, clientSocket, head) => {
    if (provider !== 'openai' || !isAllowedConnect(request.url, allowedHost, allowedPort)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    const [host, portText] = request.url.split(':');
    const upstreamSocket = connect({ host, port: Number(portText) });
    upstreamSocket.once('connect', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamSocket.once('error', () => clientSocket.destroy());
    upstreamSocket.once('close', () => clientSocket.destroy());
    clientSocket.once('error', () => upstreamSocket.destroy());
    clientSocket.once('close', () => upstreamSocket.destroy());
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createProxyServer();
  server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    if (LISTEN_PORT !== HEALTH_PORT) {
      throw new Error('LISTEN_PORT and HEALTH_PORT must match');
    }
  });
}
