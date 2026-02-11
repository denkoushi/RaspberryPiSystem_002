import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import type { BackupConfig } from './backup-config.js';
import { logger } from '../../lib/logger.js';

export type BackupConfigChangeAction =
  | 'config_update'
  | 'target_add'
  | 'target_update'
  | 'target_delete';

const REDACTED = '[REDACTED]';

const redactValue = (value?: string) => (value ? REDACTED : value);

export const redactBackupConfig = (config: BackupConfig): BackupConfig => {
  const redacted = JSON.parse(JSON.stringify(config)) as BackupConfig;
  const options = redacted.storage.options as Record<string, unknown> | undefined;
  if (!options) return redacted;

  const dropbox = (options.dropbox as Record<string, unknown> | undefined) ?? undefined;
  if (dropbox) {
    dropbox.accessToken = redactValue(dropbox.accessToken as string | undefined);
    dropbox.refreshToken = redactValue(dropbox.refreshToken as string | undefined);
    dropbox.appSecret = redactValue(dropbox.appSecret as string | undefined);
  }

  const gmail = (options.gmail as Record<string, unknown> | undefined) ?? undefined;
  if (gmail) {
    gmail.accessToken = redactValue(gmail.accessToken as string | undefined);
    gmail.refreshToken = redactValue(gmail.refreshToken as string | undefined);
    gmail.clientSecret = redactValue(gmail.clientSecret as string | undefined);
  }

  // 旧キー（後方互換）
  options.accessToken = redactValue(options.accessToken as string | undefined);
  options.refreshToken = redactValue(options.refreshToken as string | undefined);
  options.appSecret = redactValue(options.appSecret as string | undefined);
  options.clientSecret = redactValue(options.clientSecret as string | undefined);
  options.gmailAccessToken = redactValue(options.gmailAccessToken as string | undefined);
  options.gmailRefreshToken = redactValue(options.gmailRefreshToken as string | undefined);

  return redacted;
};

export class BackupConfigHistoryService {
  async recordChange(params: {
    actionType: BackupConfigChangeAction;
    actorUserId?: string;
    actorUsername?: string;
    summary?: string;
    diff?: Record<string, unknown>;
    snapshotRedacted: BackupConfig;
  }): Promise<void> {
    try {
      await prisma.backupConfigChange.create({
        data: {
          actionType: params.actionType,
          actorUserId: params.actorUserId,
          actorUsername: params.actorUsername,
          summary: params.summary,
          diff: params.diff as Prisma.InputJsonValue | undefined,
          snapshotRedacted: params.snapshotRedacted as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      // 履歴は補助情報のため、DB未整備（migration未適用）では本処理を落とさない
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
        logger?.warn({ err: error }, '[BackupConfigHistoryService] BackupConfigChange table missing; skipping history record');
        return;
      }
      throw error;
    }
  }
}
