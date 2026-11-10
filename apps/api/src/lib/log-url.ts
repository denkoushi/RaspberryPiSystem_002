import type { FastifyRequest } from 'fastify';

// 認証に使うクエリパラメータはログへ値を残さない（サイネージ画像の key、WebRTC の clientKey など）
const SENSITIVE_QUERY_PARAM_NAMES = new Set([
  'key',
  'clientkey',
  'client_key',
  'apikey',
  'api_key',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'code',
  'password',
  'secret',
]);

export function redactUrlForLog(url: string | undefined): string | undefined {
  if (typeof url !== 'string') return url;
  const queryIndex = url.indexOf('?');
  if (queryIndex < 0) return url;
  const path = url.slice(0, queryIndex);
  const query = url.slice(queryIndex + 1);
  const redacted = query
    .split('&')
    .map((part) => {
      const equalsIndex = part.indexOf('=');
      const rawName = equalsIndex < 0 ? part : part.slice(0, equalsIndex);
      let name = rawName;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      } catch {
        // 復号できない名前はそのまま判定する
      }
      return equalsIndex >= 0 && SENSITIVE_QUERY_PARAM_NAMES.has(name.toLowerCase())
        ? `${rawName}=[REDACTED]`
        : part;
    })
    .join('&');
  return `${path}?${redacted}`;
}

// Fastify 既定の req シリアライザと同じ項目を出し、URL のクエリだけ伏せる
export function serializeRequestForLog(request: FastifyRequest): {
  method?: string;
  url?: string;
  version?: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
} {
  const version = request.headers?.['accept-version'];
  return {
    method: request.method,
    url: redactUrlForLog(request.url),
    version: Array.isArray(version) ? version.join(',') : version,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket ? request.socket.remotePort : undefined,
  };
}
