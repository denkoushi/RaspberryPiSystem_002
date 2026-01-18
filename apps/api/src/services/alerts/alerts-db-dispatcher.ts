import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, type AlertsRouteKey } from './alerts-config.js';
import { sendSlackWebhook } from './slack-sink.js';
import { AlertChannel, AlertDeliveryStatus, type Alert as DbAlert, type AlertDelivery as DbAlertDelivery } from '@prisma/client';

type DbDeliveryWithAlert = DbAlertDelivery & { alert: DbAlert };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeAlertFingerprint(alert: DbAlert, routeKey: AlertsRouteKey): string {
  if (alert.fingerprint && alert.fingerprint.trim() !== '') return alert.fingerprint;
  const basis = {
    routeKey,
    type: alert.type ?? null,
    message: alert.message ?? null,
    // source/context は運用上のノイズになり得るため、まずは弱く効かせる（存在する場合のみ）
    source: alert.source ?? null,
    context: alert.context ?? null
  };
  return crypto.createHash('sha256').update(stableStringify(basis)).digest('hex');
}

export function resolveDedupeWindowSeconds(config: { defaultWindowSeconds: number; windowSecondsByRouteKey: Partial<Record<AlertsRouteKey, number>> }, routeKey: AlertsRouteKey): number {
  const raw = config.windowSecondsByRouteKey[routeKey];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  return config.defaultWindowSeconds;
}

export function computeBackoffSeconds(baseRetryDelaySeconds: number, attemptCountAfterIncrement: number): number {
  const base = clamp(Math.floor(baseRetryDelaySeconds), 1, 3600);
  const exp = clamp(attemptCountAfterIncrement - 1, 0, 20);
  const seconds = base * Math.pow(2, exp);
  return clamp(Math.floor(seconds), base, 3600);
}

export class AlertsDbDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Run dispatcher once using current configuration.
   * - 主にテスト・手動デバッグ用途
   */
  async runOnceNow(): Promise<void> {
    const config = await loadAlertsDispatcherConfig();
    if (!config.dbDispatcher.enabled) return;
    if (!config.slack.enabled) return;
    await this.runOnce(config);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[AlertsDbDispatcher] Already running');
      return;
    }

    const config = await loadAlertsDispatcherConfig();
    if (!config.dbDispatcher.enabled) {
      logger?.info('[AlertsDbDispatcher] Disabled (ALERTS_DB_DISPATCHER_ENABLED=false)');
      return;
    }

    if (!config.slack.enabled) {
      logger?.info('[AlertsDbDispatcher] Disabled (slack.enabled=false)');
      return;
    }

    this.isRunning = true;
    logger?.info(
      { intervalSeconds: config.dbDispatcher.intervalSeconds, batchSize: config.dbDispatcher.batchSize },
      '[AlertsDbDispatcher] Starting'
    );

    await this.runOnce(config).catch((err) => logger?.warn({ err }, '[AlertsDbDispatcher] Initial run failed'));
    this.timer = setInterval(() => {
      this.runOnce(config).catch((err) => logger?.warn({ err }, '[AlertsDbDispatcher] Run failed'));
    }, config.dbDispatcher.intervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  private async runOnce(config: Awaited<ReturnType<typeof loadAlertsDispatcherConfig>>): Promise<void> {
    const now = new Date();

    const eligible = await prisma.alertDelivery.findMany({
      where: {
        channel: AlertChannel.SLACK,
        status: { in: [AlertDeliveryStatus.PENDING, AlertDeliveryStatus.FAILED] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: config.dbDispatcher.batchSize,
      include: { alert: true }
    });

    if (eligible.length === 0) return;

    // Best-effort claim: push nextAttemptAt forward briefly to reduce duplicate work across processes.
    const leaseUntil = new Date(now.getTime() + config.dbDispatcher.claimLeaseSeconds * 1000);
    const ids = eligible.map((d) => d.id);
    await prisma.alertDelivery.updateMany({
      where: {
        id: { in: ids },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      },
      data: { nextAttemptAt: leaseUntil }
    });

    // Preload recent SENT fingerprints per routeKey (dedupe window)
    const fingerprintsByRoute = new Map<AlertsRouteKey, Set<string>>();
    if (config.dedupe.enabled) {
      const keys: AlertsRouteKey[] = ['deploy', 'ops', 'support', 'security'];
      await Promise.all(
        keys.map(async (rk) => {
          const windowSeconds = resolveDedupeWindowSeconds(config.dedupe, rk);
          if (windowSeconds <= 0) {
            fingerprintsByRoute.set(rk, new Set());
            return;
          }
          const since = new Date(now.getTime() - windowSeconds * 1000);
          const recent = await prisma.alertDelivery.findMany({
            where: {
              channel: AlertChannel.SLACK,
              routeKey: rk,
              status: AlertDeliveryStatus.SENT,
              sentAt: { gte: since }
            },
            include: { alert: true }
          });
          const set = new Set<string>();
          for (const d of recent) {
            set.add(computeAlertFingerprint(d.alert, rk));
          }
          fingerprintsByRoute.set(rk, set);
        })
      );
    }

    let sent = 0;
    let failed = 0;
    let suppressed = 0;

    for (const delivery of eligible as DbDeliveryWithAlert[]) {
      const routeKey = delivery.routeKey as AlertsRouteKey;
      if (!['deploy', 'ops', 'support', 'security'].includes(routeKey)) {
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: AlertDeliveryStatus.FAILED,
            lastAttemptAt: now,
            attemptCount: delivery.attemptCount + 1,
            lastError: `Unknown routeKey: ${delivery.routeKey}`,
            nextAttemptAt: null
          }
        });
        failed++;
        continue;
      }

      // Acknowledged alerts should not be notified
      if (delivery.alert.acknowledged) {
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: AlertDeliveryStatus.SUPPRESSED,
            lastAttemptAt: now,
            lastError: 'Acknowledged',
            nextAttemptAt: null
          }
        });
        suppressed++;
        continue;
      }

      // Phase1互換: 初回送信候補で24時間より古いものは送らない
      if (delivery.attemptCount === 0) {
        const ageMs = now.getTime() - delivery.alert.timestamp.getTime();
        if (ageMs > 24 * 60 * 60 * 1000) {
          await prisma.alertDelivery.update({
            where: { id: delivery.id },
            data: {
              status: AlertDeliveryStatus.SUPPRESSED,
              lastAttemptAt: now,
              lastError: 'Too old (>24h)',
              nextAttemptAt: null
            }
          });
          suppressed++;
          continue;
        }
      }

      const fingerprint = computeAlertFingerprint(delivery.alert, routeKey);
      if (!delivery.alert.fingerprint) {
        await prisma.alert.update({ where: { id: delivery.alertId }, data: { fingerprint } }).catch(() => undefined);
      }

      if (config.dedupe.enabled) {
        const set = fingerprintsByRoute.get(routeKey) ?? new Set<string>();
        const windowSeconds = resolveDedupeWindowSeconds(config.dedupe, routeKey);
        if (windowSeconds > 0 && set.has(fingerprint)) {
          await prisma.alertDelivery.update({
            where: { id: delivery.id },
            data: {
              status: AlertDeliveryStatus.SUPPRESSED,
              lastAttemptAt: now,
              lastError: `Dedupe window (${windowSeconds}s)`,
              nextAttemptAt: null
            }
          });
          suppressed++;
          continue;
        }
      }

      const webhookUrl = config.slack.webhooks[routeKey];
      if (!webhookUrl) {
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: AlertDeliveryStatus.FAILED,
            lastAttemptAt: now,
            attemptCount: delivery.attemptCount + 1,
            lastError: `Missing slack webhook for routeKey=${routeKey}`,
            nextAttemptAt: null
          }
        });
        failed++;
        continue;
      }

      const attemptCount = delivery.attemptCount + 1;
      const result = await sendSlackWebhook({
        webhookUrl,
        routeKey,
        alert: {
          id: delivery.alert.id,
          type: delivery.alert.type ?? undefined,
          severity: delivery.alert.severity ?? undefined,
          message: delivery.alert.message ?? undefined,
          details: delivery.alert.details ?? undefined,
          timestamp: delivery.alert.timestamp.toISOString(),
          source: delivery.alert.source ?? undefined,
          context: delivery.alert.context ?? undefined
        },
        timeoutMs: config.webhookTimeoutMs
      });

      if (result.ok) {
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: AlertDeliveryStatus.SENT,
            attemptCount,
            lastAttemptAt: now,
            sentAt: now,
            lastError: null,
            nextAttemptAt: null
          }
        });
        if (config.dedupe.enabled) {
          (fingerprintsByRoute.get(routeKey) ?? new Set()).add(fingerprint);
        }
        sent++;
        continue;
      }

      const maxAttempts = config.maxAttempts;
      if (attemptCount >= maxAttempts) {
        await prisma.alertDelivery.update({
          where: { id: delivery.id },
          data: {
            status: AlertDeliveryStatus.FAILED,
            attemptCount,
            lastAttemptAt: now,
            lastError: result.error,
            nextAttemptAt: null
          }
        });
        failed++;
        continue;
      }

      const backoffSeconds = computeBackoffSeconds(config.retryDelaySeconds, attemptCount);
      const nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000);
      await prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: AlertDeliveryStatus.FAILED,
          attemptCount,
          lastAttemptAt: now,
          lastError: result.error,
          nextAttemptAt
        }
      });
      failed++;
      logger?.warn(
        { routeKey, alertId: delivery.alertId, attemptCount, backoffSeconds, error: result.error },
        '[AlertsDbDispatcher] Slack delivery failed'
      );
    }

    logger?.info({ processed: eligible.length, sent, failed, suppressed }, '[AlertsDbDispatcher] Run completed');
  }
}

let dbDispatcherInstance: AlertsDbDispatcher | null = null;

export function getAlertsDbDispatcher(): AlertsDbDispatcher {
  if (!dbDispatcherInstance) {
    dbDispatcherInstance = new AlertsDbDispatcher();
  }
  return dbDispatcherInstance;
}

