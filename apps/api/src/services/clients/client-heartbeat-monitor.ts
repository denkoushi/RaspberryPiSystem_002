import crypto from 'crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity, Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { runExclusiveSchedulerTick } from '../../lib/exclusive-scheduler-tick.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';
import {
  HEARTBEAT_RECOVERED_ALERT_TYPE,
  HEARTBEAT_STALE_ALERT_TYPE,
  isMonitoredClient,
  isStale,
  loadHeartbeatAlertConfig,
  recoveredAlertFingerprint,
  recoveredAlertMessage,
  staleAlertFingerprint,
  staleAlertMessage,
  type HeartbeatAlertConfig
} from './client-heartbeat-alert-policy.js';

const INTERVAL_MS = 60_000;

type NewAlert = {
  type: string;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  fingerprint: string;
  timestamp: Date;
};

async function enqueueSlackAlert(alert: NewAlert): Promise<void> {
  const routing = (await loadAlertsDispatcherConfig()).routing;
  const routeKey = resolveRouteKey(alert.type, routing);
  await prisma.$transaction(async (tx) => {
    const created = await tx.alert.create({
      data: {
        id: crypto.randomUUID(),
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        details: alert.details as Prisma.InputJsonValue,
        source: {
          service: 'client-heartbeat-monitor',
          clientId: alert.details.clientId
        } as Prisma.InputJsonValue,
        fingerprint: alert.fingerprint,
        timestamp: alert.timestamp,
        acknowledged: false
      }
    });
    await tx.alertDelivery.create({
      data: {
        alertId: created.id,
        channel: AlertChannel.SLACK,
        routeKey,
        status: AlertDeliveryStatus.PENDING,
        attemptCount: 0
      }
    });
  });
}

/**
 * 1回分の見回り。
 * - 監視対象の端末が staleAfter を超えて無連絡なら、途絶1回につき1件 WARNING を Slack へ積む。
 * - 途絶を通知済みの端末から連絡が戻ったら、途絶 Alert を確認済みにして復帰を通知する。
 *   通知前に戻った短い途絶は、途絶 Alert を確認済みにするだけ（Slack 側で抑止される）。
 */
export async function runHeartbeatCheck(now: Date, config: HeartbeatAlertConfig): Promise<void> {
  const statuses = await prisma.clientStatus.findMany({
    where: { lastSeen: { gte: new Date(now.getTime() - config.forgetAfterMs) } },
    select: { clientId: true, lastSeen: true }
  });
  const monitored = statuses.filter((status) => isMonitoredClient(status.clientId, config));
  const lastSeenByClient = new Map(monitored.map((status) => [status.clientId, status.lastSeen]));

  for (const status of monitored) {
    if (!isStale(status, now, config)) continue;
    const fingerprint = staleAlertFingerprint(status.clientId, status.lastSeen);
    const existing = await prisma.alert.findFirst({ where: { fingerprint }, select: { id: true } });
    if (existing) continue;
    await enqueueSlackAlert({
      type: HEARTBEAT_STALE_ALERT_TYPE,
      severity: AlertSeverity.WARNING,
      message: staleAlertMessage(status, now),
      details: { clientId: status.clientId, lastSeen: status.lastSeen.toISOString() },
      fingerprint,
      timestamp: now
    });
  }

  const openStaleAlerts = await prisma.alert.findMany({
    where: { type: HEARTBEAT_STALE_ALERT_TYPE, acknowledged: false },
    select: {
      id: true,
      fingerprint: true,
      details: true,
      deliveries: { select: { status: true } }
    }
  });
  for (const alert of openStaleAlerts) {
    const details = (alert.details ?? {}) as { clientId?: unknown; lastSeen?: unknown };
    if (typeof details.clientId !== 'string' || typeof details.lastSeen !== 'string') continue;
    const silentSince = new Date(details.lastSeen);
    const currentLastSeen = lastSeenByClient.get(details.clientId);
    if (!currentLastSeen || currentLastSeen.getTime() <= silentSince.getTime()) continue;

    await prisma.alert.update({
      where: { id: alert.id },
      data: { acknowledged: true, acknowledgedAt: now }
    });
    const wasNotified = alert.deliveries.some((delivery) => delivery.status === AlertDeliveryStatus.SENT);
    if (!wasNotified || !alert.fingerprint) continue;
    await enqueueSlackAlert({
      type: HEARTBEAT_RECOVERED_ALERT_TYPE,
      severity: AlertSeverity.INFO,
      message: recoveredAlertMessage(details.clientId, silentSince, currentLastSeen),
      details: {
        clientId: details.clientId,
        lastSeen: details.lastSeen,
        recoveredAt: currentLastSeen.toISOString()
      },
      fingerprint: recoveredAlertFingerprint(alert.fingerprint),
      timestamp: now
    });
  }
}

export class ClientHeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private startedAt: number | null = null;
  private readonly tickExclusive = { locked: false };

  async start(): Promise<void> {
    if (this.timer) return;
    const config = loadHeartbeatAlertConfig();
    if (!config.enabled) {
      logger?.info('[ClientHeartbeatMonitor] Disabled (CLIENT_HEARTBEAT_ALERT_ENABLED=false)');
      return;
    }
    this.startedAt = Date.now();
    logger?.info(
      { staleAfterMinutes: config.staleAfterMs / 60_000, clientIdPattern: config.clientIdPattern.source },
      '[ClientHeartbeatMonitor] Starting'
    );
    this.timer = setInterval(() => {
      void runExclusiveSchedulerTick(this.tickExclusive, logger, 'ClientHeartbeatMonitor', async () => {
        // API 自身（Pi5）が止まっていた直後は全端末の lastSeen が古いので、端末が再送するまで待つ。
        if (this.startedAt === null || Date.now() - this.startedAt < config.staleAfterMs) return;
        await runHeartbeatCheck(new Date(), config);
      }).catch((err) => logger?.warn({ err }, '[ClientHeartbeatMonitor] Run failed'));
    }, INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.startedAt = null;
  }
}

let instance: ClientHeartbeatMonitor | null = null;

export function getClientHeartbeatMonitor(): ClientHeartbeatMonitor {
  if (!instance) instance = new ClientHeartbeatMonitor();
  return instance;
}
