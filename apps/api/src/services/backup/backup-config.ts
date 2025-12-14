import { z } from 'zod';

/**
 * バックアップ設定のスキーマ
 */
export const BackupConfigSchema = z.object({
  storage: z.object({
    provider: z.enum(['local', 'dropbox']),
    options: z.object({
      basePath: z.string().optional(),
      accessToken: z.string().optional() // Dropbox用
    }).optional()
  }),
  targets: z.array(z.object({
    kind: z.enum(['database', 'file', 'directory', 'csv', 'image']),
    source: z.string(),
    schedule: z.string().optional(), // cron形式（例: "0 4 * * *"）
    enabled: z.boolean().default(true),
    metadata: z.record(z.unknown()).optional()
  })),
  retention: z.object({
    days: z.number().default(30),
    maxBackups: z.number().optional()
  }).optional()
});

export type BackupConfig = z.infer<typeof BackupConfigSchema>;

/**
 * デフォルトのバックアップ設定
 */
export const defaultBackupConfig: BackupConfig = {
  storage: {
    provider: 'local',
    options: {
      basePath: '/opt/RaspberryPiSystem_002/backups'
    }
  },
  targets: [
    {
      kind: 'database',
      source: 'postgresql://postgres:postgres@localhost:5432/borrow_return',
      schedule: '0 4 * * *', // 毎日4時
      enabled: true
    },
    {
      kind: 'csv',
      source: 'employees',
      schedule: '0 5 * * *', // 毎日5時
      enabled: true
    },
    {
      kind: 'csv',
      source: 'items',
      schedule: '0 5 * * *', // 毎日5時
      enabled: true
    },
    {
      kind: 'image',
      source: 'photo-storage',
      schedule: '0 6 * * *', // 毎日6時
      enabled: true
    }
  ],
  retention: {
    days: 30,
    maxBackups: 100
  }
};
