import { z } from 'zod';

/**
 * CSVインポートタイプ
 */
export const CsvImportTypeSchema = z.enum(['employees', 'items', 'measuringInstruments', 'riggingGears']);

/**
 * CSVインポートターゲット（スケジュール内の1つの対象）
 */
export const CsvImportTargetSchema = z.object({
  type: CsvImportTypeSchema,
  source: z.string() // Dropbox用: パス、Gmail用: 件名パターン
});

export type CsvImportTarget = z.infer<typeof CsvImportTargetSchema>;

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
    provider: z.enum(['local', 'dropbox', 'gmail']),
    options: z.object({
      basePath: z.string().optional(),
      // Dropbox用設定
      accessToken: z.string().optional(), // Dropbox用
      refreshToken: z.string().optional(), // Dropbox/Gmail用（リフレッシュトークン）
      appKey: z.string().optional(), // Dropbox用（OAuth 2.0 App Key）
      appSecret: z.string().optional(), // Dropbox用（OAuth 2.0 App Secret）
      // Gmail用設定
      clientId: z.string().optional(), // Gmail用（OAuth 2.0 Client ID）
      clientSecret: z.string().optional(), // Gmail用（OAuth 2.0 Client Secret）
      redirectUri: z.string().optional(), // Gmail用（OAuth リダイレクトURI）
      subjectPattern: z.string().optional(), // Gmail用（件名パターン）
      fromEmail: z.string().optional(), // Gmail用（送信者メールアドレス）
      // NOTE: dropbox と gmail の token フィールド衝突を避けるための分離キー（後方互換: accessToken/refreshToken も許容）
      gmailAccessToken: z.string().optional(),
      gmailRefreshToken: z.string().optional()
    }).optional()
  }),
  pathMappings: z.array(PathMappingSchema).optional(), // Dockerコンテナ内のパスマッピング
  targets: z.array(z.object({
    kind: z.enum(['database', 'file', 'directory', 'csv', 'image', 'client-file', 'client-directory']),
    source: z.string(),
    schedule: z.string().optional(), // cron形式（例: "0 4 * * *"）
    enabled: z.boolean().default(true),
    storage: z.object({
      provider: z.enum(['local', 'dropbox', 'gmail']).optional(), // 対象ごとのストレージプロバイダー（単一、後方互換性のため残す）
      providers: z.array(z.enum(['local', 'dropbox', 'gmail'])).optional() // 対象ごとのストレージプロバイダー（複数、Phase 2）
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
    provider: z.enum(['dropbox', 'gmail']).optional(), // プロバイダーを選択可能に（オプション、デフォルト: storage.provider）
    // 新形式: targets配列（汎用化）
    targets: z.array(CsvImportTargetSchema).optional(),
    // 旧形式: 後方互換のため残す（読み込み時にtargetsへ変換）
    employeesPath: z.string().optional(), // Dropbox用: パス、Gmail用: 件名パターン
    itemsPath: z.string().optional(), // Dropbox用: パス、Gmail用: 件名パターン
    schedule: z.string(), // cron形式（例: "0 4 * * *"）
    enabled: z.boolean().default(true),
    replaceExisting: z.boolean().default(false), // 既存データを置き換えるか
    retryConfig: z.object({
      maxRetries: z.number().default(3), // 最大リトライ回数（デフォルト: 3）
      retryInterval: z.number().default(60), // リトライ間隔（秒、デフォルト: 60）
      exponentialBackoff: z.boolean().default(true) // 指数バックオフ（デフォルト: true）
    }).optional(),
    autoBackupAfterImport: z.object({
      enabled: z.boolean().default(false), // 自動バックアップを有効にするか
      targets: z.array(z.enum(['csv', 'database', 'all'])).default(['csv']) // バックアップ対象（csv: CSVのみ、database: データベースのみ、all: すべて）
    }).optional().default({ enabled: false, targets: ['csv'] }),
    metadata: z.record(z.unknown()).optional()
  })).optional().default([]),
  // Gmail件名パターン管理（タイプ別の候補配列）
  csvImportSubjectPatterns: z.record(
    CsvImportTypeSchema,
    z.array(z.string())
  ).optional().default({
    employees: [
      '[Pi5 CSV Import] employees',
      '[CSV Import] employees',
      'CSV Import - employees',
      '従業員CSVインポート'
    ],
    items: [
      '[Pi5 CSV Import] items',
      '[CSV Import] items',
      'CSV Import - items',
      'アイテムCSVインポート'
    ],
    measuringInstruments: [
      '[Pi5 CSV Import] measuring-instruments',
      '[CSV Import] measuring-instruments',
      'CSV Import - measuring-instruments',
      '計測機器CSVインポート'
    ],
    riggingGears: [
      '[Pi5 CSV Import] rigging-gears',
      '[CSV Import] rigging-gears',
      'CSV Import - rigging-gears',
      '吊具CSVインポート'
    ]
  }),
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
  csvImportSubjectPatterns: {
    employees: [
      '[Pi5 CSV Import] employees',
      '[CSV Import] employees',
      'CSV Import - employees',
      '従業員CSVインポート'
    ],
    items: [
      '[Pi5 CSV Import] items',
      '[CSV Import] items',
      'CSV Import - items',
      'アイテムCSVインポート'
    ],
    measuringInstruments: [
      '[Pi5 CSV Import] measuring-instruments',
      '[CSV Import] measuring-instruments',
      'CSV Import - measuring-instruments',
      '計測機器CSVインポート'
    ],
    riggingGears: [
      '[Pi5 CSV Import] rigging-gears',
      '[CSV Import] rigging-gears',
      'CSV Import - rigging-gears',
      '吊具CSVインポート'
    ]
  },
  csvImportHistory: {
    retentionDays: 90,
    cleanupSchedule: '0 2 * * *' // 毎日2時
  },
  restoreFromDropbox: {
    enabled: false,
    verifyIntegrity: true
  }
};
