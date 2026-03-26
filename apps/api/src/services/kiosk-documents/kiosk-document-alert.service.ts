import crypto from 'crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity, type Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';

export class KioskDocumentAlertService {
  async notifyPermanentFailure(documentId: string, reason: string): Promise<void> {
    const type = 'kiosk-document-ocr-failed';
    const message = `要領書OCRが失敗しました (documentId=${documentId})`;
    await this.createDbAlert(type, message, { documentId, reason });
  }

  async notifyBatchFailure(reason: string): Promise<void> {
    const type = 'kiosk-document-ocr-batch-failed';
    const message = '要領書OCR夜間バッチが異常終了しました';
    await this.createDbAlert(type, message, { reason });
  }

  private async createDbAlert(type: string, message: string, details: Record<string, unknown>): Promise<void> {
    const alertId = crypto.randomUUID();
    try {
      const config = await loadAlertsDispatcherConfig();
      const routeKey = resolveRouteKey(type, config.routing);

      await prisma.alert.create({
        data: {
          id: alertId,
          type,
          severity: AlertSeverity.WARNING,
          message,
          details: details as Prisma.InputJsonValue,
          timestamp: new Date(),
          acknowledged: false,
          fingerprint: crypto.createHash('sha256').update(`${type}:${message}`).digest('hex'),
        },
      });
      await prisma.alertDelivery.create({
        data: {
          alertId,
          channel: AlertChannel.SLACK,
          routeKey,
          status: AlertDeliveryStatus.PENDING,
          attemptCount: 0,
        },
      });
    } catch (error) {
      logger.warn({ err: error, type, details }, '[KioskDocumentAlert] failed to create db alert');
    }
  }
}
