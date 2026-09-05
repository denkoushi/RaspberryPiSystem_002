import net from 'node:net';
import http from 'node:http';

const LISTEN_HOST = process.env.LISTEN_HOST ?? '0.0.0.0';
const LISTEN_PORT = Number(process.env.LISTEN_PORT ?? 3128);
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? LISTEN_PORT);
const ALLOWED_HOST = 'api.openai.com';

export function isAllowedConnect(target, allowedHost = ALLOWED_HOST, allowedPort = '443') {
  if (typeof target !== 'string') return false;
  const separator = target.lastIndexOf(':');
  if (separator <= 0) return false;
  const host = target.slice(0, separator).toLowerCase();
  const port = target.slice(separator + 1);
  return host === allowedHost.toLowerCase() && port === allowedPort;
}

export function createProxyServer({
  connect = net.connect,
  allowedHost = ALLOWED_HOST,
  allowedPort = '443'
} = {}) {
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok"}');
      return;
    }
    response.writeHead(403);
    response.end();
  });

  server.on('connect', (request, clientSocket, head) => {
    if (!isAllowedConnect(request.url, allowedHost, allowedPort)) {
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
