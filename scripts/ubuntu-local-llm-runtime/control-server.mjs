#!/usr/bin/env node
/**
 * Ubuntu LocalLLM 用: llama-server のみ起動・停止する最小 HTTP 制御サーバ。
 * `local-llm-system` の docker nginx からプロキシする場合は
 * `LLM_RUNTIME_LISTEN_HOST=0.0.0.0` で待ち受ける。
 *
 * 環境変数:
 *   LLM_RUNTIME_CONTROL_TOKEN  必須（Pi5 の LOCAL_LLM_RUNTIME_CONTROL_TOKEN と一致）
 *   LLM_RUNTIME_COMPOSE_DIR    既定: /home/localllm/local-llm-system/compose
 *   LLM_RUNTIME_LISTEN_HOST    既定: 127.0.0.1（docker nginx 経由時は 0.0.0.0）
 *   LLM_RUNTIME_LISTEN_PORT    既定: 39090
 */
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TOKEN = process.env.LLM_RUNTIME_CONTROL_TOKEN?.trim();
const COMPOSE_DIR = process.env.LLM_RUNTIME_COMPOSE_DIR?.trim() || '/home/localllm/local-llm-system/compose';
const HOST = process.env.LLM_RUNTIME_LISTEN_HOST?.trim() || '127.0.0.1';
const PORT = Number.parseInt(process.env.LLM_RUNTIME_LISTEN_PORT?.trim() || '39090', 10);

if (!TOKEN) {
  console.error('LLM_RUNTIME_CONTROL_TOKEN is required');
  process.exit(1);
}

function authOk(req) {
  const h = req.headers['x-runtime-control-token'];
  const v = Array.isArray(h) ? h[0] : h;
  return v === TOKEN;
}

async function runCompose(args) {
  await execFileAsync('docker', ['compose', ...args], {
    cwd: COMPOSE_DIR,
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

const server = http.createServer(async (req, res) => {
  if (!authOk(req)) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('unauthorized');
    return;
  }

  const url = req.url || '/';
  try {
    if (req.method === 'POST' && url === '/start') {
      await runCompose(['start', 'llama-server']);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, action: 'start' }));
      return;
    }
    if (req.method === 'POST' && url === '/stop') {
      await runCompose(['stop', 'llama-server']);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, action: 'stop' }));
      return;
    }
    if (req.method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok\n');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (err) {
    console.error('[llm-runtime-control]', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err instanceof Error ? err.message : 'error');
  }
});

server.listen(PORT, HOST, () => {
  console.error(`[llm-runtime-control] listening on http://${HOST}:${PORT}`);
});
