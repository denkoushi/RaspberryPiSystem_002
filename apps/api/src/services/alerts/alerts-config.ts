import { promises as fs } from 'fs';
import path from 'path';

export type AlertsRouteKey = 'deploy' | 'ops' | 'support' | 'security';

export type AlertsDispatcherConfig = {
  enabled: boolean;
  intervalSeconds: number;
  maxAttempts: number;
  retryDelaySeconds: number;
  webhookTimeoutMs: number;
  alertsDir: string;
  slack: {
    enabled: boolean;
    webhooks: Partial<Record<AlertsRouteKey, string>>;
  };
  routing: {
    byTypePrefix: Record<string, AlertsRouteKey>;
    defaultRoute: AlertsRouteKey;
  };
};

type AlertsConfigFile = Partial<{
  enabled: boolean;
  intervalSeconds: number;
  maxAttempts: number;
  retryDelaySeconds: number;
  webhookTimeoutMs: number;
  alertsDir: string;
  slack: {
    enabled?: boolean;
    webhooks?: Partial<Record<AlertsRouteKey, string>>;
  };
  routing: {
    byTypePrefix?: Record<string, AlertsRouteKey>;
    defaultRoute?: AlertsRouteKey;
  };
}>;

function defaultRouting(): AlertsDispatcherConfig['routing'] {
  return {
    // NOTE: prefix match (startsWith)
    byTypePrefix: {
      'ansible-update-': 'deploy',
      'ansible-health-check-': 'deploy',
      'storage-': 'ops',
      'csv-import-': 'ops',
      // API側の既存アラート例
      role_change: 'security',
      'kiosk-support': 'support'
    },
    defaultRoute: 'ops'
  };
}

/**
 * アラートタイプからrouteKeyを解決する
 * @param type アラートタイプ（例: "ansible-update-failed"）
 * @param routing ルーティング設定
 * @returns routeKey（deploy/ops/support/security）
 */
export function resolveRouteKey(
  type: string | undefined,
  routing: { byTypePrefix: Record<string, AlertsRouteKey>; defaultRoute: AlertsRouteKey }
): AlertsRouteKey {
  if (!type) return routing.defaultRoute;
  const entries = Object.entries(routing.byTypePrefix);
  for (const [prefix, routeKey] of entries) {
    if (type.startsWith(prefix)) return routeKey;
  }
  return routing.defaultRoute;
}

export async function loadAlertsDispatcherConfig(): Promise<AlertsDispatcherConfig> {
  const alertsDir = process.env.ALERTS_DIR ?? path.join(process.cwd(), 'alerts');

  const asBool = (value: string | undefined, fallback: boolean): boolean => {
    if (!value) return fallback;
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    return fallback;
  };

  const asNumber = (value: string | undefined, fallback: number, opts?: { min?: number; max?: number }): number => {
    if (!value) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (opts?.min !== undefined && n < opts.min) return fallback;
    if (opts?.max !== undefined && n > opts.max) return fallback;
    return n;
  };

  const asUrl = (value: string | undefined): string | undefined => {
    const v = value?.trim();
    if (!v) return undefined;
    try {
      // eslint-disable-next-line no-new
      new URL(v);
      return v;
    } catch {
      return undefined;
    }
  };

  const base: AlertsDispatcherConfig = {
    enabled: asBool(process.env.ALERTS_DISPATCHER_ENABLED, false),
    intervalSeconds: asNumber(process.env.ALERTS_DISPATCHER_INTERVAL_SECONDS, 30, { min: 5, max: 3600 }),
    maxAttempts: asNumber(process.env.ALERTS_DISPATCHER_MAX_ATTEMPTS, 5, { min: 1, max: 20 }),
    retryDelaySeconds: asNumber(process.env.ALERTS_DISPATCHER_RETRY_DELAY_SECONDS, 60, { min: 5, max: 3600 }),
    webhookTimeoutMs: asNumber(process.env.ALERTS_DISPATCHER_WEBHOOK_TIMEOUT_MS, 5000, { min: 500, max: 30000 }),
    alertsDir,
    slack: {
      enabled: true,
      webhooks: {
        deploy: asUrl(process.env.ALERTS_SLACK_WEBHOOK_DEPLOY),
        ops: asUrl(process.env.ALERTS_SLACK_WEBHOOK_OPS),
        support: asUrl(process.env.ALERTS_SLACK_WEBHOOK_SUPPORT),
        security: asUrl(process.env.ALERTS_SLACK_WEBHOOK_SECURITY)
      }
    },
    routing: defaultRouting()
  };

  const configPath = process.env.ALERTS_CONFIG_PATH?.trim();
  if (!configPath) {
    return base;
  }

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as AlertsConfigFile;

    const merged: AlertsDispatcherConfig = {
      ...base,
      enabled: parsed.enabled ?? base.enabled,
      intervalSeconds: parsed.intervalSeconds ?? base.intervalSeconds,
      maxAttempts: parsed.maxAttempts ?? base.maxAttempts,
      retryDelaySeconds: parsed.retryDelaySeconds ?? base.retryDelaySeconds,
      webhookTimeoutMs: parsed.webhookTimeoutMs ?? base.webhookTimeoutMs,
      alertsDir: parsed.alertsDir ?? base.alertsDir,
      slack: {
        enabled: parsed.slack?.enabled ?? base.slack.enabled,
        webhooks: {
          ...base.slack.webhooks,
          ...(parsed.slack?.webhooks ?? {})
        }
      },
      routing: {
        byTypePrefix: parsed.routing?.byTypePrefix ?? base.routing.byTypePrefix,
        defaultRoute: parsed.routing?.defaultRoute ?? base.routing.defaultRoute
      }
    };

    return merged;
  } catch {
    // 設定ファイルが壊れていても、既存システムを壊さないためbaseで継続
    return base;
  }
}

