import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, type AlertsRouteKey, resolveRouteKey } from './alerts-config.js';
import { sendSlackWebhook } from './slack-sink.js';

type SlackDeliveryState = {
  status: 'sent' | 'failed';
  routeKey: AlertsRouteKey;
  attempts: number;
  lastAttemptAt: string;
  sentAt?: string;
  lastError?: string;
};

type AlertFile = {
  id?: string;
  type?: string;
  severity?: string;
  message?: string;
  details?: unknown;
  timestamp?: string;
  acknowledged?: boolean;
  deliveries?: {
    slack?: Record<string, SlackDeliveryState>;
  };
  [key: string]: unknown;
};

/**
 * アラートの再送が必要かどうかを判定
 * @param state 既存の配送状態（undefinedの場合は初回送信候補）
 * @param alert アラートファイルの内容
 * @param nowMs 現在時刻（ミリ秒）
 * @param retryDelaySeconds リトライ間隔（秒）
 * @param maxAttempts 最大試行回数
 * @returns 再送が必要な場合true
 */
function shouldRetry(
  state: SlackDeliveryState | undefined,
  alert: AlertFile,
  nowMs: number,
  retryDelaySeconds: number,
  maxAttempts: number
): boolean {
  // 既に送信済みの場合は再送しない
  if (state?.status === 'sent') return false;

  // 最大試行回数に達している場合は再送しない
  if (state && state.attempts >= maxAttempts) return false;

  // stateが存在する場合（失敗時のリトライ）
  if (state) {
    const last = Date.parse(state.lastAttemptAt);
    if (!Number.isFinite(last)) return true;
    return nowMs - last >= retryDelaySeconds * 1000;
  }

  // stateが存在しない場合（初回送信候補）
  // 過去のアラート（24時間以上古い）は再送しない
  if (alert.timestamp) {
    const alertTime = Date.parse(alert.timestamp);
    if (Number.isFinite(alertTime)) {
      const ageMs = nowMs - alertTime;
      const maxAgeMs = 24 * 60 * 60 * 1000; // 24時間
      if (ageMs > maxAgeMs) {
        return false; // 過去のアラートは再送しない
      }
    }
  }

  // 新規アラート（24時間以内）は初回送信として扱う
  return true;
}

export class AlertsDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Run dispatcher once using current configuration.
   * - 主にテスト・手動デバッグ用途
   */
  async runOnceNow(): Promise<void> {
    const config = await loadAlertsDispatcherConfig();
    if (!config.enabled) return;
    await this.runOnce(config);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[AlertsDispatcher] Already running');
      return;
    }

    const config = await loadAlertsDispatcherConfig();
    if (!config.enabled) {
      logger?.info('[AlertsDispatcher] Disabled (ALERTS_DISPATCHER_ENABLED=false)');
      return;
    }

    this.isRunning = true;
    logger?.info(
      { intervalSeconds: config.intervalSeconds, alertsDir: config.alertsDir },
      '[AlertsDispatcher] Starting'
    );

    // First run immediately, then on interval
    await this.runOnce(config).catch((err) => logger?.warn({ err }, '[AlertsDispatcher] Initial run failed'));
    this.timer = setInterval(() => {
      this.runOnce(config).catch((err) => logger?.warn({ err }, '[AlertsDispatcher] Run failed'));
    }, config.intervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  private async runOnce(config: Awaited<ReturnType<typeof loadAlertsDispatcherConfig>>): Promise<void> {
    // If Slack webhooks are not configured, do nothing (still keep alerts as primary store)
    if (!config.slack.enabled) {
      return;
    }

    const files = await this.listAlertFiles(config.alertsDir);
    if (files.length === 0) return;

    const nowMs = Date.now();

    // Process newest first to improve timeliness, but keep workload bounded
    const candidates = files.slice(-50).reverse();

    for (const filePath of candidates) {
      const alert = await this.readAlert(filePath);
      if (!alert) continue;
      if (alert.acknowledged) continue;

      const routeKey = resolveRouteKey(alert.type, config.routing);
      const webhookUrl = config.slack.webhooks[routeKey];
      if (!webhookUrl) {
        continue;
      }

      const state = alert.deliveries?.slack?.[routeKey];
      if (!shouldRetry(state, alert, nowMs, config.retryDelaySeconds, config.maxAttempts)) {
        continue;
      }

      const attempts = (state?.attempts ?? 0) + 1;
      const lastAttemptAt = new Date().toISOString();

      const result = await sendSlackWebhook({
        webhookUrl,
        routeKey,
        alert,
        timeoutMs: config.webhookTimeoutMs
      });

      const next: SlackDeliveryState = result.ok
        ? { status: 'sent', routeKey, attempts, lastAttemptAt, sentAt: lastAttemptAt }
        : { status: 'failed', routeKey, attempts, lastAttemptAt, lastError: result.error };

      await this.writeDeliveryState(filePath, alert, routeKey, next);

      if (!result.ok) {
        logger?.warn(
          { routeKey, type: alert.type, id: alert.id, attempts, error: result.error },
          '[AlertsDispatcher] Slack delivery failed'
        );
      }
    }
  }

  private async listAlertFiles(alertsDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(alertsDir);
      const files = entries.filter((f) => f.startsWith('alert-') && f.endsWith('.json'));
      return files.map((f) => path.join(alertsDir, f)).sort();
    } catch {
      return [];
    }
  }

  private async readAlert(filePath: string): Promise<AlertFile | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as AlertFile;
    } catch {
      return null;
    }
  }

  private async writeDeliveryState(
    filePath: string,
    alert: AlertFile,
    routeKey: AlertsRouteKey,
    state: SlackDeliveryState
  ): Promise<void> {
    try {
      const deliveries = alert.deliveries ?? {};
      const slack = deliveries.slack ?? {};
      slack[routeKey] = state;
      deliveries.slack = slack;
      alert.deliveries = deliveries;

      await fs.writeFile(filePath, JSON.stringify(alert, null, 2), 'utf-8');
    } catch (err) {
      logger?.warn({ err, filePath }, '[AlertsDispatcher] Failed to persist delivery state');
    }
  }
}

// Singleton instance (same pattern as other schedulers)
let dispatcherInstance: AlertsDispatcher | null = null;

export function getAlertsDispatcher(): AlertsDispatcher {
  if (!dispatcherInstance) {
    dispatcherInstance = new AlertsDispatcher();
  }
  return dispatcherInstance;
}

