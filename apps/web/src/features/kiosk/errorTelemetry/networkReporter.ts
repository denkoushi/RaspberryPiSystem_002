import { urlPath } from './reporter';

export const NETWORK_WINDOW_MS = 300000;
export const NETWORK_SAMPLE_LIMIT = 500;
export type NetworkLog = { level: 'INFO'; message: string; context: Record<string, unknown> };
export interface NetworkObservation {
  url?: string;
  status?: number;
  code?: string;
  durationMs: number;
  streaming?: boolean;
}
interface NetworkEnvironment {
  now(): number;
  route(): string;
  online(): boolean;
  connection?(): { effectiveType?: unknown; downlink?: unknown; rtt?: unknown } | undefined;
}

export function excludedNetworkRequest(input: NetworkObservation): boolean {
  if (!input.url || input.streaming || input.code === 'ERR_CANCELED') return true;
  const url = new URL(input.url, 'https://kiosk.invalid');
  return /^wss?:$/.test(url.protocol) || /\/clients\/logs\/?$/.test(url.pathname)
    || /\/(?:stream|sse)(?:\/|$)/.test(url.pathname)
    || /\/webrtc\/signaling(?:\/|$)/.test(url.pathname);
}

export class KioskNetworkReporter {
  private windowStart: number;
  private requests = 0;
  private failures = 0;
  private samples: number[] = [];
  private maxMs = 0;
  private send?: (logs: NetworkLog[]) => Promise<unknown>;

  constructor(private readonly env: NetworkEnvironment) { this.windowStart = env.now(); }
  setTransport(send: (logs: NetworkLog[]) => Promise<unknown>) { this.send = send; }

  record(input: NetworkObservation): void {
    try {
      // A delayed background timer must not merge subsequent windows indefinitely.
      void this.flush();
      if (!this.env.route().startsWith('/kiosk') || excludedNetworkRequest(input)
        || !Number.isFinite(input.durationMs) || input.durationMs < 0) return;
      this.requests += 1;
      if (input.status === undefined || input.status >= 500) this.failures += 1;
      const ms = Math.round(input.durationMs);
      this.maxMs = Math.max(this.maxMs, ms);
      if (this.samples.length < NETWORK_SAMPLE_LIMIT) this.samples.push(ms);
    } catch { /* Optional observations never affect requests. */ }
  }

  async flush(): Promise<void> {
    try {
      const now = this.env.now();
      if (now - this.windowStart < NETWORK_WINDOW_MS) return;
      const start = this.windowStart;
      const requests = this.requests;
      const failures = this.failures;
      const maxMs = this.maxMs;
      const samples = this.samples;
      // Drop the completed window before any asynchronous work, including a failed send.
      this.windowStart = now - ((now - start) % NETWORK_WINDOW_MS);
      this.requests = 0;
      this.failures = 0;
      this.maxMs = 0;
      this.samples = [];
      const route = this.env.route();
      if (!requests || !route.startsWith('/kiosk') || !this.send) return;
      samples.sort((a, b) => a - b);
      const percentile = (p: number) => samples[Math.max(0, Math.ceil(samples.length * p) - 1)];
      const context: Record<string, unknown> = {
        category: 'kiosk_net_stats', route: urlPath(route), windowStart: new Date(start).toISOString(),
        windowSeconds: NETWORK_WINDOW_MS / 1000, requests, failures,
        p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs, online: this.env.online()
      };
      try {
        const connection = this.env.connection?.();
        if (['slow-2g', '2g', '3g', '4g'].includes(String(connection?.effectiveType))) context.effectiveType = connection?.effectiveType;
        for (const [key, value] of [['downlinkMbps', connection?.downlink], ['rttMs', connection?.rtt]] as const) {
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) context[key] = value;
        }
      } catch { /* Browser connection information is optional. */ }
      await this.send([{ level: 'INFO', message: 'キオスクAPI応答時間の集計', context }]);
    } catch { /* No persistence or retries. */ }
  }
}
