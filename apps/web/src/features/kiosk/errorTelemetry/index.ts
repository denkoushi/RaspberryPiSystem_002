import { readProductionBuildConfig } from '../../../config/productionBuildConfig';

import { KioskErrorReporter, urlPath, type ErrorKind } from './reporter';

let reporter: KioskErrorReporter | undefined;
let initialized = false;
function getReporter() {
  if (!reporter && typeof window !== 'undefined') {
    reporter = new KioskErrorReporter({
      route: () => window.location.pathname,
      online: () => navigator.onLine,
      now: () => Date.now(),
      storage: () => window.localStorage,
      releaseSha: readProductionBuildConfig().releaseSha
    });
  }
  return reporter;
}
export function reportKioskException(kind: 'render_crash' | 'window_error' | 'unhandled_rejection', error: unknown, recoveryDecision?: string) {
  try {
    const data = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: 'Error', message: 'Unknown exception' };
    return getReporter()?.record(kind, { ...data, recoveryDecision });
  } catch { return; }
}
export function reportKioskApi(input: { method?: string; url?: string; status?: number; code?: string; apiCode?: unknown; requestId?: unknown; durationMs: number }) {
  try {
    if (!input.url || input.status === 401 || input.code === 'ERR_CANCELED') return;
    let kind: ErrorKind;
    if (input.code === 'ECONNABORTED' || input.code === 'ETIMEDOUT') kind = 'api_timeout';
    else if (!input.status) kind = 'api_network';
    else if (input.status >= 500) kind = 'api_5xx';
    else if (input.status >= 400) kind = 'api_4xx';
    else if (input.durationMs >= 10000) kind = 'slow_request';
    else return;
    getReporter()?.record(kind, { ...input, urlPath: urlPath(input.url) });
  } catch { /* Best effort. */ }
}
export function initializeKioskErrorTelemetry(send: (payload: { clientId: string; logs: Parameters<KioskErrorReporter['setTransport']>[0] extends (logs: infer L) => Promise<unknown> ? L : never }) => Promise<unknown>) {
  try {
    if (initialized) return;
    initialized = true;
    const current = getReporter();
    current?.setTransport((logs) => send({ clientId: 'kiosk-web', logs }));
    window.addEventListener('error', (event) => reportKioskException('window_error', event.error ?? new Error(event.message)));
    window.addEventListener('unhandledrejection', (event) => reportKioskException('unhandled_rejection', event.reason));
    window.addEventListener('online', () => { void current?.flush(); });
    window.setInterval(() => { void current?.flush(); }, 5000);
    void current?.flush();
  } catch { /* Best effort. */ }
}
