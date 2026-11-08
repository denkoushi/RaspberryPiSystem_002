import crypto from 'crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';

export const LOGIN_ATTEMPT_LIMIT = 10;

// Called once per window: when the attempt that reached the limit fails for a registered user.
export async function notifyLoginAttemptLimitReached(username: string): Promise<void> {
  const type = 'auth-login-limit';
  try {
    const config = await loadAlertsDispatcherConfig();
    const routeKey = resolveRouteKey(type, config.routing);
    await prisma.alert.create({
      data: {
        id: crypto.randomUUID(),
        type,
        severity: AlertSeverity.WARNING,
        message: `管理画面のログインの試行回数が上限に達しました(${username})。15 分間ログインできません`,
        details: { username },
        timestamp: new Date(),
        acknowledged: false,
        deliveries: { create: { channel: AlertChannel.SLACK, routeKey, status: AlertDeliveryStatus.PENDING, attemptCount: 0 } }
      }
    });
  } catch (error) {
    logger.warn({ err: error, type }, 'Failed to create login attempt limit alert');
  }
}
