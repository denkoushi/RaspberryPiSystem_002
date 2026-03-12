import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { UserRole } from '@prisma/client';

type AlertLogger = {
  warn: (object: Record<string, unknown>, message: string) => void;
};

type AlertFileSystemPort = {
  mkdir: typeof fs.mkdir;
  writeFile: typeof fs.writeFile;
};

type FetchPort = typeof fetch;

export type RoleChangeAlertInput = {
  actorUserId: string;
  actorUsername?: string;
  targetUserId: string;
  targetUsername: string;
  fromRole: UserRole;
  toRole: UserRole;
  reasons: string[];
  logger: AlertLogger;
};

export class RoleChangeAlertService {
  constructor(
    private readonly fileSystem: AlertFileSystemPort = fs,
    private readonly fetchPort: FetchPort = fetch
  ) {}

  async emitRoleChangeAlert(input: RoleChangeAlertInput): Promise<void> {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    const webhookTimeoutMs = Number.parseInt(process.env.ALERT_WEBHOOK_TIMEOUT_MS ?? '5000', 10);
    const alertsDir = process.env.ALERTS_DIR ?? path.join(process.cwd(), 'alerts');
    const id = crypto.randomUUID();
    const alert = {
      id,
      type: 'role_change',
      severity: 'warning',
      message: `権限変更: ${input.targetUsername} を ${input.fromRole} から ${input.toRole} に変更 (by ${input.actorUsername ?? input.actorUserId})`,
      reasons: input.reasons,
      details: {
        actorUserId: input.actorUserId,
        actorUsername: input.actorUsername,
        targetUserId: input.targetUserId,
        targetUsername: input.targetUsername,
        fromRole: input.fromRole,
        toRole: input.toRole,
      },
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };

    try {
      await this.fileSystem.mkdir(alertsDir, { recursive: true });
      const filePath = path.join(alertsDir, `alert-${id}.json`);
      await this.fileSystem.writeFile(filePath, JSON.stringify(alert, null, 2), 'utf-8');
    } catch (error) {
      input.logger.warn({ err: error, alert }, 'Failed to write role change alert');
    }

    if (!webhookUrl) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), webhookTimeoutMs);
    try {
      await this.fetchPort(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
        signal: controller.signal,
      });
    } catch (error) {
      input.logger.warn({ err: error, alert }, 'Failed to send role change alert webhook');
    } finally {
      clearTimeout(timer);
    }
  }
}
