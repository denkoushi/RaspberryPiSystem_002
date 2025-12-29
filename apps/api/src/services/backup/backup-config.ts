import { z } from 'zod';

/**
 * パスマッピング設定のスキーマ
 */
export const PathMappingSchema = z.object({
  hostPath: z.string(),
  containerPath: z.string()
});

/**
 * バックアップ設定のスキーマ
 */
export const BackupConfigSchema = z.object({
  storage: z.object({
    provider: z.enum(['local', 'dropbox']),
    options: z.object({
      basePath: z.string().optional(),
      accessToken: z.string().optional(), // Dropbox用
      refreshToken: z.string().optional(), // Dropbox用（リフレッシュトークン）
      appKey: z.string().optional(), // Dropbox用（OAuth 2.0 App Key）
      appSecret: z.string().optional() // Dropbox用（OAuth 2.0 App Secret）
    }).optional()
  }),
  pathMappings: z.array(PathMappingSchema).optional(), // Dockerコンテナ内のパスマッピング
  targets: z.array(z.object({
    kind: z.enum(['database', 'file', 'directory', 'csv', 'image', 'client-file']),
    source: z.string(),
    schedule: z.string().optional(), // cron形式（例: "0 4 * * *"）
    enabled: z.boolean().default(true),
    storage: z.object({
      provider: z.enum(['local', 'dropbox']).optional(), // 対象ごとのストレージプロバイダー（単一、後方互換性のため残す）
      providers: z.array(z.enum(['local', 'dropbox'])).optional() // 対象ごとのストレージプロバイダー（複数、Phase 2）
    }).optional(),
    retention: z.object({
      days: z.number().optional(), // 保持日数（例: 30日）
      maxBackups: z.number().optional() // 最大保持数（例: 10件）
    }).optional(), // 対象ごとの保持期間設定（Phase 3）
    metadata: z.record(z.unknown()).optional()
  })),
  retention: z.object({
    days: z.number().default(30),
    maxBackups: z.number().optional()
  }).optional(),
  csvImports: z.array(z.object({
    id: z.string(), // スケジュールID（一意）
    name: z.string().optional(), // スケジュール名（表示用）
    employeesPath: z.string().optional(), // Dropbox上の従業員CSVパス
    itemsPath: z.string().optional(), // Dropbox上のアイテムCSVパス
    schedule: z.string(), // cron形式（例: "0 4 * * *"）
    enabled: z.boolean().default(true),
    replaceExisting: z.boolean().default(false), // 既存データを置き換えるか
    autoBackupAfterImport: z.object({
      enabled: z.boolean().default(false), // 自動バックアップを有効にするか
      targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv']) // バックアップ対象（csv: CSVのみ、database: データベースのみ、all: すべて）
    }).optional().default({ enabled: false, targets: ['csv'] }),
    metadata: z.record(z.unknown()).optional()
  })).optional().default([]),
  csvImportHistory: z.object({
    retentionDays: z.number().default(90), // 履歴保持期間（日数）
    cleanupSchedule: z.string().optional().default('0 2 * * *') // クリーンアップ実行スケジュール（cron形式、デフォルト: 毎日2時）
  }).optional(),
  restoreFromDropbox: z.object({
    enabled: z.boolean().default(false), // Dropboxからのリストア機能を有効にするか
    verifyIntegrity: z.boolean().default(true), // リストア時に整合性検証を実行するか
    defaultTargetKind: z.enum(['database', 'csv']).optional() // デフォルトのリストア対象の種類
  }).optional().default({ enabled: false, verifyIntegrity: true })
});

export type BackupConfig = z.infer<typeof BackupConfigSchema>;

/**
 * デフォルトのバックアップ設定
 */
export const defaultBackupConfig: BackupConfig = {
  storage: {
    provider: 'local',
    options: {
      basePath: '/opt/backups'
    }
  },
  pathMappings: [
    { hostPath: '/opt/RaspberryPiSystem_002/apps/api/.env', containerPath: '/app/host/apps/api/.env' },
    { hostPath: '/opt/RaspberryPiSystem_002/apps/web/.env', containerPath: '/app/host/apps/web/.env' },
    {
      hostPath: '/opt/RaspberryPiSystem_002/infrastructure/docker/.env',
      containerPath: '/app/host/infrastructure/docker/.env'
    },
    {
      hostPath: '/opt/RaspberryPiSystem_002/clients/nfc-agent/.env',
      containerPath: '/app/host/clients/nfc-agent/.env'
    }
  ],
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
  },
  csvImports: [],
  csvImportHistory: {
    retentionDays: 90,
    cleanupSchedule: '0 2 * * *' // 毎日2時
  },
  restoreFromDropbox: {
    enabled: false,
    verifyIntegrity: true
  }
};
