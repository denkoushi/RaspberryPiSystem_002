import type { IncomingHttpHeaders } from 'http';

// 認証に使うヘッダーはログへ値を残さない
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'x-client-key',
  'x-business-hermes-mcp-key',
  'x-deploy-control-token',
  'x-due-management-token',
  'x-kiosk-access-password',
  'x-procedure-edit-token',
  'x-visual-cleanup-token',
]);

export function redactHeadersForLog(headers: IncomingHttpHeaders): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    sanitized[name] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? '[REDACTED]' : value;
  }
  return sanitized;
}
