import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from './alerts-config.js';
import { AlertSeverity, AlertChannel, AlertDeliveryStatus } from '@prisma/client';

type AlertFile = {
  id?: string;
  type?: string;
  severity?: string;
  message?: string;
  details?: unknown;
  timestamp?: string;
  acknowledged?: boolean;
  source?: unknown;
  context?: unknown;
  fingerprint?: string;
  [key: string]: unknown;
};

function parseSeverity(severity: string | undefined): AlertSeverity | null {
  if (!severity) return null;
  const upper = severity.toUpperCase();
  if (upper === 'INFO' || upper === 'WARNING' || upper === 'ERROR' || upper === 'CRITICAL') {
    return upper as AlertSeverity;
  }
  return null;
}

function parseTimestamp(timestamp: string | undefined): Date | null {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

async function listAlertFiles(alertsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(alertsDir);
    const files = entries.filter((f) => f.startsWith('alert-') && f.endsWith('.json'));
    return files.map((f) => path.join(alertsDir, f)).sort();
  } catch {
    return [];
  }
}

async function readAlert(filePath: string): Promise<AlertFile | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as AlertFile;
  } catch {
    return null;
  }
}

export class AlertsIngestor {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Run ingestor once using current configuration.
   * - 主にテスト・手動デバッグ用途
   */
  async ingestOnceNow(): Promise<void> {
    const config = await loadAlertsDispatcherConfig();
    const ingestConfig = {
      enabled: process.env.ALERTS_DB_INGEST_ENABLED === 'true',
      intervalSeconds: Number(process.env.ALERTS_DB_INGEST_INTERVAL_SECONDS) || 60,
      limit: Number(process.env.ALERTS_DB_INGEST_LIMIT) || 50
    };
    if (!ingestConfig.enabled) return;
    await this.ingestOnce(config, ingestConfig);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger?.warn('[AlertsIngestor] Already running');
      return;
    }

    const ingestConfig = {
      enabled: process.env.ALERTS_DB_INGEST_ENABLED === 'true',
      intervalSeconds: Number(process.env.ALERTS_DB_INGEST_INTERVAL_SECONDS) || 60,
      limit: Number(process.env.ALERTS_DB_INGEST_LIMIT) || 50
    };

    if (!ingestConfig.enabled) {
      logger?.info('[AlertsIngestor] Disabled (ALERTS_DB_INGEST_ENABLED=false)');
      return;
    }

    const config = await loadAlertsDispatcherConfig();

    this.isRunning = true;
    logger?.info(
      { intervalSeconds: ingestConfig.intervalSeconds, alertsDir: config.alertsDir, limit: ingestConfig.limit },
      '[AlertsIngestor] Starting'
    );

    // First run immediately, then on interval
    await this.ingestOnce(config, ingestConfig).catch((err) => logger?.warn({ err }, '[AlertsIngestor] Initial run failed'));
    this.timer = setInterval(() => {
      this.ingestOnce(config, ingestConfig).catch((err) => logger?.warn({ err }, '[AlertsIngestor] Run failed'));
    }, ingestConfig.intervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  private async ingestOnce(
    config: Awaited<ReturnType<typeof loadAlertsDispatcherConfig>>,
    ingestConfig: { enabled: boolean; intervalSeconds: number; limit: number }
  ): Promise<void> {
    const files = await listAlertFiles(config.alertsDir);
    if (files.length === 0) return;

    // Process newest first, but keep workload bounded
    const candidates = files.slice(-ingestConfig.limit).reverse();

    let ingested = 0;
    let skipped = 0;
    let errors = 0;

    for (const filePath of candidates) {
      const alert = await readAlert(filePath);
      if (!alert) {
        errors++;
        continue;
      }

      // idが必須（ファイルのidをAlert.idとして使用）
      if (!alert.id) {
        logger?.warn({ filePath }, '[AlertsIngestor] Alert file missing id, skipping');
        skipped++;
        continue;
      }

      const timestamp = parseTimestamp(alert.timestamp);
      if (!timestamp) {
        logger?.warn({ filePath, id: alert.id }, '[AlertsIngestor] Alert file missing or invalid timestamp, skipping');
        skipped++;
        continue;
      }

      try {
        // Alertをupsert（idで一意化）
        await prisma.alert.upsert({
          where: { id: alert.id },
          create: {
            id: alert.id,
            type: alert.type ?? null,
            severity: parseSeverity(alert.severity),
            message: alert.message ?? null,
            details: alert.details ? (typeof alert.details === 'string' ? { raw: alert.details } : alert.details) : undefined,
            source: alert.source ? (typeof alert.source === 'object' ? alert.source : { raw: alert.source }) : undefined,
            context: alert.context ? (typeof alert.context === 'object' ? alert.context : { raw: alert.context }) : undefined,
            fingerprint: alert.fingerprint ?? null,
            timestamp,
            acknowledged: alert.acknowledged ?? false,
            acknowledgedAt: alert.acknowledged ? timestamp : null
          },
          update: {
            // ファイル側の更新を反映（acknowledged, timestamp等）
            type: alert.type ?? undefined,
            severity: parseSeverity(alert.severity) ?? undefined,
            message: alert.message ?? undefined,
            details: alert.details ? (typeof alert.details === 'string' ? { raw: alert.details } : alert.details) : undefined,
            source: alert.source ? (typeof alert.source === 'object' ? alert.source : { raw: alert.source }) : undefined,
            context: alert.context ? (typeof alert.context === 'object' ? alert.context : { raw: alert.context }) : undefined,
            fingerprint: alert.fingerprint ?? undefined,
            timestamp,
            acknowledged: alert.acknowledged ?? false,
            acknowledgedAt: alert.acknowledged ? timestamp : undefined
          }
        });

        // AlertDeliveryを初回作成（既に存在する場合はスキップ）
        const routeKey = resolveRouteKey(alert.type, config.routing);
        try {
          await prisma.alertDelivery.upsert({
            where: {
              alertId_channel_routeKey: {
                alertId: alert.id,
                channel: AlertChannel.SLACK,
                routeKey
              }
            },
            create: {
              alertId: alert.id,
              channel: AlertChannel.SLACK,
              routeKey,
              status: AlertDeliveryStatus.PENDING,
              attemptCount: 0
            },
            update: {
              // 既存の場合は更新しない（配送状態はDispatcherが管理）
            }
          });
        } catch (err) {
          // unique制約違反などは無視（既に存在する場合）
          logger?.debug({ alertId: alert.id, routeKey }, '[AlertsIngestor] AlertDelivery already exists, skipping');
        }

        ingested++;
      } catch (err) {
        logger?.warn({ err, filePath, id: alert.id }, '[AlertsIngestor] Failed to ingest alert');
        errors++;
      }
    }

    if (ingested > 0 || skipped > 0 || errors > 0) {
      logger?.info({ ingested, skipped, errors }, '[AlertsIngestor] Ingest completed');
    }
  }
}

// Singleton instance (same pattern as other schedulers)
let ingestorInstance: AlertsIngestor | null = null;

export function getAlertsIngestor(): AlertsIngestor {
  if (!ingestorInstance) {
    ingestorInstance = new AlertsIngestor();
  }
  return ingestorInstance;
}
