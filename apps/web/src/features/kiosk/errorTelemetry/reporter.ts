export type ErrorKind = 'render_crash' | 'window_error' | 'unhandled_rejection' | 'api_network' | 'api_timeout' | 'api_5xx' | 'api_4xx' | 'slow_request';
type Log = { level: 'ERROR' | 'WARN'; message: string; context: Record<string, unknown> };
type Pending = { fingerprint: string; log: Log };
export const QUEUE_KEY = 'kiosk-ui-error-queue-v1';
const KINDS: ErrorKind[] = ['render_crash', 'window_error', 'unhandled_rejection', 'api_network', 'api_timeout', 'api_5xx', 'api_4xx', 'slow_request'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// The same failure keeps aggregating locally and reaches the server at most once per minute.
export const RESEND_INTERVAL_MS = 60000;
// Browsers raise this on harmless layout races; it never blocks an operation.
const BENIGN_MESSAGE = /^ResizeObserver loop/;
const safeSignal = (value: unknown) => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : undefined;
export const urlPath = (url: string): string => new URL(url, 'https://kiosk.invalid').pathname;
// Never serialize arbitrary rejection objects, axios payloads, or URL query values.
const safeText = (text: string) => text
  .replace(/([\w/+.-]+)\?[^\s)]+/g, '$1?[redacted]')
  .replace(/(?:authorization|x-client-key|token|password|secret|input|value)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
  .replace(/Bearer\s+\S+/gi, '[redacted]')
  .replace(/(['"`])(.*?)\1/g, (quoted, _mark, inner: string) => /^[\w$.-]{1,40}$/.test(inner) ? quoted : '[redacted]');

export interface ReporterEnvironment {
  route(): string;
  online(): boolean;
  now(): number;
  storage(): Pick<Storage, 'getItem' | 'setItem'>;
  releaseSha?: string;
}
export class KioskErrorReporter {
  private queue: Pending[] = [];
  private dropped = 0;
  private attempts: number[] = [];
  private sending = false;
  private lastSent = new Map<string, number>();
  private send?: (logs: Log[]) => Promise<unknown>;
  constructor(private readonly env: ReporterEnvironment) {
    try {
      const saved = JSON.parse(env.storage().getItem(QUEUE_KEY) ?? '{}');
      if (Array.isArray(saved.queue)) {
        for (const item of saved.queue.slice(0, 50)) {
          const c = item?.log?.context;
          if (!c || !KINDS.includes(c.kind) || typeof c.route !== 'string' || !c.route.startsWith('/kiosk') || typeof c.occurredAt !== 'string' || !Number.isFinite(Date.parse(c.occurredAt))) continue;
          // Rebuild from the allowlist, even when storage has been corrupted/edited.
          this.record(c.kind, { ...c, message: item.log.message }, c);
        }
      }
      this.dropped = Number.isSafeInteger(saved.dropped) && saved.dropped >= 0 ? saved.dropped : 0;
      this.attempts = Array.isArray(saved.attempts) ? saved.attempts.filter((t: unknown) => typeof t === 'number' && t > env.now() - 60000).slice(0, 20) : [];
    } catch { /* Storage is optional. */ }
  }
  setTransport(send: (logs: Log[]) => Promise<unknown>) { this.send = send; }
  private persist() {
    try { this.env.storage().setItem(QUEUE_KEY, JSON.stringify({ queue: this.queue, dropped: this.dropped, attempts: this.attempts })); } catch { /* Never affect the UI. */ }
  }
  record(kind: ErrorKind, data: Record<string, unknown> = {}, restored?: Record<string, unknown>): { incidentCode: string; occurredAt: string } | undefined {
    try {
      if (!this.env.route().startsWith('/kiosk') && !restored) return;
      const path = typeof data.urlPath === 'string' ? urlPath(data.urlPath) : undefined;
      if (path && /\/clients\/logs\/?$/.test(path)) return;
      const occurredAt = restored ? String(restored.occurredAt) : new Date(this.env.now()).toISOString();
      const incidentCode = restored && /^[A-HJ-NP-Z2-9]{6}$/.test(String(restored.incidentCode)) ? String(restored.incidentCode) : Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
      const exception = ['render_crash', 'window_error', 'unhandled_rejection'].includes(kind);
      if (kind === 'window_error' && typeof data.message === 'string' && BENIGN_MESSAGE.test(data.message)) return;
      const message = exception ? safeText(typeof data.message === 'string' ? data.message : 'Unknown exception').slice(0, 1000) || 'Unknown exception' : `Kiosk API: ${kind}`;
      const context: Record<string, unknown> = {
        category: 'kiosk_ui_error', kind, route: restored ? restored.route : this.env.route(), occurredAt,
        count: restored && Number.isSafeInteger(restored.count) && Number(restored.count) > 0 ? restored.count : 1,
        incidentCode, online: restored ? restored.online === true : this.env.online()
      };
      if (this.env.releaseSha) context.releaseSha = this.env.releaseSha;
      if (exception) {
        context.name = safeSignal(data.name) ?? 'Error';
        if (typeof data.stack === 'string') context.stack = safeText(data.stack).slice(0, 2000);
        if (kind === 'render_crash' && ['reload', 'stop', 'decision_failed'].includes(String(data.recoveryDecision))) context.recoveryDecision = data.recoveryDecision;
      } else {
        context.method = safeSignal(data.method)?.toUpperCase();
        context.urlPath = path;
        context.status = typeof data.status === 'number' ? data.status : null;
        context.apiCode = safeSignal(data.apiCode);
        context.requestId = safeSignal(data.requestId);
        context.durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? Math.max(0, Math.round(data.durationMs)) : 0;
      }
      const fingerprint = JSON.stringify(exception ? [kind, context.name, message.slice(0, 200)] : [kind, context.method, path, context.status]);
      const existing = this.queue.find((item) => item.fingerprint === fingerprint);
      if (existing) {
        Object.assign(existing.log.context, context, { count: Number(existing.log.context.count) + Number(context.count) });
      } else if (this.queue.length < 50 && (restored || this.attempts.filter((time) => time > this.env.now() - 60000).length < 20)) {
        this.queue.push({ fingerprint, log: { level: kind === 'api_4xx' || kind === 'slow_request' ? 'WARN' : 'ERROR', message, context } });
      } else { this.dropped += Number(context.count); }
      this.persist();
      if (kind === 'render_crash' && !restored) void this.flush();
      return { incidentCode, occurredAt };
    } catch { return; }
  }
  async flush(): Promise<void> {
    try {
      if (!this.send || this.sending || !this.env.route().startsWith('/kiosk') || !this.env.online() || !this.queue.length) return;
      const now = this.env.now();
      this.attempts = this.attempts.filter((time) => time > now - 60000);
      const available = 20 - this.attempts.length;
      if (!available) { this.persist(); return; }
      const due = this.queue.filter((item) => item.log.context.kind === 'render_crash' || (this.lastSent.get(item.fingerprint) ?? -Infinity) <= now - RESEND_INTERVAL_MS);
      if (!due.length) return;
      const batch = due.slice(0, available).map((item) => ({ ...item, log: { ...item.log, context: { ...item.log.context } } }));
      const dropped = this.dropped;
      if (dropped) batch[0].log.context.droppedCount = dropped;
      this.attempts.push(...batch.map(() => now));
      this.sending = true;
      this.persist();
      try {
        await this.send(batch.map((item) => item.log));
        for (const item of batch) {
          this.lastSent.set(item.fingerprint, now);
          const current = this.queue.find((queued) => queued.fingerprint === item.fingerprint);
          if (!current) continue;
          const remaining = Number(current.log.context.count) - Number(item.log.context.count);
          if (remaining > 0) current.log.context.count = remaining;
          else this.queue = this.queue.filter((queued) => queued !== current);
        }
        for (const [fingerprint, time] of this.lastSent) if (time <= now - RESEND_INTERVAL_MS) this.lastSent.delete(fingerprint);
        this.dropped = Math.max(0, this.dropped - dropped);
      } catch { /* Retain unsent rows. */ }
      finally { this.sending = false; this.persist(); }
    } catch { /* Telemetry must never break the application. */ }
  }
}
