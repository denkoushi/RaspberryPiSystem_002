import { randomUUID } from 'node:crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';

export async function notifySharedJwtSecret(): Promise<void> {
  const type = 'auth-shared-jwt-secret';
  try {
    const config = await loadAlertsDispatcherConfig();
    await prisma.alert.create({ data: {
      id: randomUUID(), type, severity: AlertSeverity.WARNING,
      message: '管理画面のアクセストークンと更新トークンに同じ署名鍵が設定されています',
      timestamp: new Date(), acknowledged: false,
      deliveries: { create: { channel: AlertChannel.SLACK, routeKey: resolveRouteKey(type, config.routing), status: AlertDeliveryStatus.PENDING, attemptCount: 0 } }
    } });
  } catch {
    logger.warn({ type }, 'Failed to create JWT configuration alert');
  }
}
