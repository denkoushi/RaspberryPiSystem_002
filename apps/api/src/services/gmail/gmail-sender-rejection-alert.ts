import { randomUUID } from 'node:crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';

export async function notifyGmailSenderRejected(count: number, domains: string[], disabled: boolean): Promise<void> {
  const type = 'gmail-sender-rejected';
  try {
    const fingerprint = `${type}:${disabled ? 'empty' : 'rejected'}:${domains.join(',')}`;
    const now = new Date();
    const existing = await prisma.alert.findFirst({ where: {
      fingerprint, acknowledged: false,
      timestamp: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    } });
    if (existing) return;
    const config = await loadAlertsDispatcherConfig();
    await prisma.alert.create({ data: {
      id: randomUUID(), type, severity: AlertSeverity.WARNING,
      message: disabled ? 'Gmail取込を停止しました（許可ドメインが空です、拒否件数: 0）'
        : `Gmail取込を拒否しました: ${count}件、送信元ドメイン: ${domains.join(', ') || '不明'}`,
      details: { count, domains, disabled }, timestamp: now, acknowledged: false,
      fingerprint,
      deliveries: { create: { channel: AlertChannel.SLACK, routeKey: resolveRouteKey(type, config.routing), status: AlertDeliveryStatus.PENDING, attemptCount: 0 } },
    } });
  } catch {
    logger.warn({ type }, 'Failed to create Gmail sender rejection alert');
  }
}
