import { prisma } from '../../lib/prisma.js';
import { Prisma, type BackupConfigChange } from '@prisma/client';
import type { BackupConfig } from './backup-config.js';
import { logger } from '../../lib/logger.js';

export type BackupConfigChangeAction =
  | 'config_update'
  | 'target_add'
  | 'target_update'
  | 'target_delete';

const REDACTED = '[REDACTED]';

const redactValue = (value?: string) => (value ? REDACTED : value);

const SECRET_GROUPS = [
  { namespace: 'dropbox', keys: ['accessToken', 'refreshToken', 'appSecret'] },
  { namespace: 'gmail', keys: ['accessToken', 'refreshToken', 'clientSecret'] },
  { namespace: undefined, keys: ['accessToken', 'refreshToken', 'appSecret', 'clientSecret', 'gmailAccessToken', 'gmailRefreshToken'] },
] as const;

export const redactBackupConfig = (config: BackupConfig): BackupConfig => {
  const redacted = JSON.parse(JSON.stringify(config)) as BackupConfig;
  const options = redacted.storage.options;
  for (const { namespace, keys } of SECRET_GROUPS) {
    const group = (namespace ? options?.[namespace] : options) as Record<string, unknown> | undefined;
    if (!group) continue;
    for (const key of keys) group[key] = redactValue(group[key] as string | undefined);
  }
  return redacted;
};

/** PUTの未変更の秘密値を、環境変数展開前の設定から補完する。空文字は明示的な削除。 */
export const restoreBackupConfigSecrets = (config: BackupConfig, existing: BackupConfig): void => {
  const options = config.storage.options ??= {};
  for (const { namespace, keys } of SECRET_GROUPS) {
    const previous = (namespace ? existing.storage.options?.[namespace] : existing.storage.options) as Record<string, unknown> | undefined;
    // 本文に無い名前空間は、秘密値だけの半端な形にせず前の設定をまるごと残す。
    if (namespace && !options[namespace]) {
      if (previous) options[namespace] = structuredClone(previous);
      continue;
    }
    const group = (namespace ? options[namespace] : options) as Record<string, unknown>;
    for (const key of keys) {
      if (group[key] === REDACTED || group[key] === undefined) {
        group[key] = previous?.[key];
      }
    }
  }
};

export class BackupConfigHistoryService {
  async listHistory(params: { limit: number; offset: number }): Promise<{
    items: BackupConfigChange[];
    total: number;
  }> {
    const [items, total] = await Promise.all([
      prisma.backupConfigChange.findMany({
        orderBy: { createdAt: 'desc' },
        skip: params.offset,
        take: params.limit,
      }),
      prisma.backupConfigChange.count(),
    ]);
    return { items, total };
  }

  async getHistoryEntryById(id: string): Promise<BackupConfigChange | null> {
    return prisma.backupConfigChange.findUnique({ where: { id } });
  }

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
