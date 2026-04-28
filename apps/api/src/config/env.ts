import { config } from 'dotenv';
import { z } from 'zod';

import { parseInferenceProvidersJsonQuiet } from '../services/inference/config/inference-providers-json.schema.js';
import { collectLocalLlmProviderAlignmentIssues } from '../services/inference/config/local-llm-env-alignment.js';

config();

const SECRET_MIN_LENGTH = 32;
const WEAK_SECRET_PATTERNS = [
  'change-me',
  'dev-',
  'default',
  'example',
  'test-',
];

const isWeakSecret = (secret: string): boolean => {
  const normalized = secret.trim().toLowerCase();
  if (normalized.length < SECRET_MIN_LENGTH) {
    return true;
  }
  return WEAK_SECRET_PATTERNS.some((pattern) => normalized.includes(pattern));
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/borrow_return'),
  JWT_ACCESS_SECRET: z.string().default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().default('dev-refresh-secret-change-me'),
  TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default(process.env.NODE_ENV === 'production' ? 'warn' : 'info'),
  SIGNAGE_RENDER_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(30),
  // サイネージレンダリングは重い処理になりやすく、APIイベントループを塞ぐとキオスク操作に影響する。
  // 本番はデフォルトで "worker"（別プロセス）に逃がし、開発は従来通り "in_process"。
  SIGNAGE_RENDER_RUNNER: z
    .enum(['in_process', 'worker'])
    .default(process.env.NODE_ENV === 'production' ? 'worker' : 'in_process'),
  SIGNAGE_SCHEDULE_SWITCH_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(30),
  SIGNAGE_RENDER_WIDTH: z.coerce.number().min(640).max(7680).default(1920),
  SIGNAGE_RENDER_HEIGHT: z.coerce.number().min(480).max(4320).default(1080),
  SIGNAGE_TIMEZONE: z.string().default('Asia/Tokyo'),
  /**
   * 持出カードグリッドの描画エンジン。
   * - svg_legacy: 従来の SVG 手座標（既定・Docker 追加なしで安全）
   * - playwright_html: HTML/CSS → Chromium で PNG 化（レイアウト自由度大サイネージ worker の RAM 増）
   */
  SIGNAGE_LOAN_GRID_ENGINE: z.enum(['svg_legacy', 'playwright_html']).default('svg_legacy'),
  /** Playwright スクリーンショットの deviceScaleFactor（1〜2）。高いほど縁取りが細かいが負荷増 */
  SIGNAGE_PLAYWRIGHT_DEVICE_SCALE_FACTOR: z.coerce.number().min(1).max(2).default(1),
  NETWORK_MODE: z.enum(['local', 'maintenance']).default('local'),
  NETWORK_STATUS_OVERRIDE: z.enum(['internet_connected', 'local_network_only']).optional(),
  // NOTE:
  // docker-compose.server.yml では `${SLACK_KIOSK_SUPPORT_WEBHOOK_URL:-}` により
  // 未設定時でも空文字が注入されるため、空文字は undefined として扱う。
  SLACK_KIOSK_SUPPORT_WEBHOOK_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),

  // Alerts Dispatcher (Phase1: file alerts -> Slack)
  // NOTE:
  // - 既存システムを壊さないため、デフォルトは無効（明示的に有効化した場合のみ動作）
  ALERTS_DISPATCHER_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ),
  ALERTS_DISPATCHER_INTERVAL_SECONDS: z.coerce.number().min(5).max(3600).default(30),
  ALERTS_DISPATCHER_MAX_ATTEMPTS: z.coerce.number().min(1).max(20).default(5),
  ALERTS_DISPATCHER_RETRY_DELAY_SECONDS: z.coerce.number().min(5).max(3600).default(60),
  ALERTS_DISPATCHER_WEBHOOK_TIMEOUT_MS: z.coerce.number().min(500).max(30000).default(5000),

  // Optional JSON config path (e.g. /opt/RaspberryPiSystem_002/config/alerts.json)
  ALERTS_CONFIG_PATH: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),

  // Slack Webhooks (route-based). Empty string should be treated as undefined.
  ALERTS_SLACK_WEBHOOK_DEPLOY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  ALERTS_SLACK_WEBHOOK_OPS: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  ALERTS_SLACK_WEBHOOK_SUPPORT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  ALERTS_SLACK_WEBHOOK_SECURITY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),

  // Alerts DB Ingest (Phase2: file alerts -> DB)
  // NOTE:
  // - 既存システムを壊さないため、デフォルトは無効（明示的に有効化した場合のみ動作）
  ALERTS_DB_INGEST_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ),
  ALERTS_DB_INGEST_INTERVAL_SECONDS: z.coerce.number().min(10).max(3600).default(60),
  ALERTS_DB_INGEST_LIMIT: z.coerce.number().min(1).max(1000).default(50),

  // Gmail trash cleanup (processed label in trash -> hard delete)
  GMAIL_TRASH_CLEANUP_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ),
  GMAIL_TRASH_CLEANUP_CRON: z.string().default('0 3 * * *'),
  GMAIL_TRASH_CLEANUP_LABEL: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string().min(1).default('rps_processed')
  ),
  DUE_MGMT_TUNING_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ).transform((v) => v === 'true'),
  DUE_MGMT_TUNING_CRON: z.string().default('15 2 * * *'),
  DUE_MGMT_TUNING_LOCATIONS: z.string().default('shared-global-rank'),
  DUE_MGMT_TUNING_IMPROVEMENT_STREAK_REQUIRED: z.coerce.number().int().min(1).max(14).default(2),
  DUE_MGMT_TUNING_MAX_WEIGHT_DELTA: z.coerce.number().min(0.01).max(0.5).default(0.08),
  DUE_MGMT_TUNING_EXCLUDED_DATES: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  DUE_MGMT_TUNING_EXCLUDE_WEEKENDS: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ).transform((v) => v === 'true'),
  RATE_LIMIT_REDIS_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  KIOSK_SUPPORT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(3),
  KIOSK_SUPPORT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60 * 1000),
  KIOSK_POWER_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(1),
  KIOSK_POWER_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60 * 1000),
  ACTUAL_HOURS_SHARED_FALLBACK_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('false')
  ),
  // 手動順番を deviceScopeKey 正とし、Mac 代理は targetDeviceScopeKey 必須にする v2 契約（無効時は従来の targetLocation 動作）
  KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.enum(['true', 'false']).default('true')
  ).transform((v) => v === 'true'),
  LOCAL_LLM_BASE_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  LOCAL_LLM_SHARED_TOKEN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  LOCAL_LLM_MODEL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  LOCAL_LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),

  /**
   * always_on: llama-server 常駐を前提（制御 API は no-op）
   * on_demand: 推論前に起動・セッション後に停止（LOCAL_LLM_RUNTIME_CONTROL_* が揃うときのみ実際に HTTP 制御）
   */
  LOCAL_LLM_RUNTIME_MODE: z.enum(['always_on', 'on_demand']).default('always_on'),
  /** Ubuntu 側制御サーバの起動 URL（POST）。on_demand 運用時に設定 */
  LOCAL_LLM_RUNTIME_CONTROL_START_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  /** 未指定時は LOCAL_LLM_SHARED_TOKEN を流用可能 */
  LOCAL_LLM_RUNTIME_CONTROL_TOKEN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /** /healthz 待ちの基底 URL。未指定時は LOCAL_LLM_BASE_URL */
  LOCAL_LLM_RUNTIME_HEALTH_BASE_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS: z.coerce.number().int().min(5000).max(1800000).default(180000),
  LOCAL_LLM_RUNTIME_START_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(60000),
  LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS: z.coerce.number().int().min(200).max(30_000).default(2000),
  /**
   * true かつ LOCAL_LLM_RUNTIME_MODE=on_demand のとき、指定タイムゾーンの時間帯内は release 後も /stop を送らず warm 維持する。
   * 既定は無効（従来どおり refCount=0 で停止）。
   */
  LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  LOCAL_LLM_RUNTIME_WARM_WINDOW_TIMEZONE: z.string().min(1).default('Asia/Tokyo'),
  /** warm 窓の開始時（この時を含む。0–23） */
  LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  /** warm 窓の終了時（この時を含まない。0–23）。07–23 なら 07:00〜22:59 が warm */
  LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR: z.coerce.number().int().min(0).max(23).default(23),

  /**
   * 推論プロバイダ配列（JSON）。未設定時は LOCAL_LLM_* から id=default を1件合成。
   * 例:
   * [{"id":"default","baseUrl":"http://host:8080","sharedToken":"...","defaultModel":"qwen","timeoutMs":60000,
   *   "runtimeControl":{"mode":"on_demand","startUrl":"http://host:8080/start","stopUrl":"http://host:8080/stop","controlToken":"...","healthBaseUrl":"http://host:8080"}}]
   */
  INFERENCE_PROVIDERS_JSON: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  /** 管理用 LocalLLM プロキシの接続先プロバイダ id（未指定時は default 優先、その次に先頭） */
  INFERENCE_ADMIN_PROVIDER_ID: z.string().min(1).max(64).default('default'),
  /** 管理用 LocalLLM プロキシの model override。未指定時は provider.defaultModel */
  INFERENCE_ADMIN_MODEL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /** 写真持出 VLM の接続先プロバイダ id（INFERENCE_PROVIDERS_JSON または default） */
  INFERENCE_PHOTO_LABEL_PROVIDER_ID: z.string().min(1).max(64).default('default'),
  INFERENCE_PHOTO_LABEL_MODEL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  INFERENCE_PHOTO_LABEL_VISION_MAX_TOKENS: z.coerce.number().int().min(16).max(4096).default(64),
  INFERENCE_PHOTO_LABEL_VISION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),

  /** 要領書 OCR テキスト要約（任意）の接続先 */
  INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: z.string().min(1).max(64).default('default'),
  INFERENCE_DOCUMENT_SUMMARY_MODEL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /** true のとき OCR 完了後に document_summary 用途でテキスト要約を試行（失敗時は従来スニペットへフォールバック） */
  KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  INFERENCE_DOCUMENT_SUMMARY_MAX_TOKENS: z.coerce.number().int().min(32).max(4096).default(512),
  INFERENCE_DOCUMENT_SUMMARY_INPUT_MAX_CHARS: z.coerce.number().int().min(1000).max(200_000).default(24_000),
  INFERENCE_DOCUMENT_SUMMARY_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),

  /** 写真持出 VLM 工具名ラベル: cron（node-cron 5 フィールド: 分 時 日 月 曜） */
  PHOTO_TOOL_LABEL_CRON: z.string().default('*/5 * * * *'),
  PHOTO_TOOL_LABEL_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(3),
  PHOTO_TOOL_LABEL_STALE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  /** VLM 入力: 元画像を長辺このpx以下に収めて JPEG 再エンコード（thumbnail 時は無視） */
  PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE: z.coerce.number().int().min(256).max(2048).default(768),
  PHOTO_TOOL_LABEL_VISION_JPEG_QUALITY: z.coerce.number().int().min(50).max(100).default(85),
  /** 未設定時はコード内デフォルトプロンプト */
  PHOTO_TOOL_LABEL_USER_PROMPT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /** original: 保存済み本画像をリサイズ。thumbnail: 従来どおりサムネのみ（切り戻し用） */
  PHOTO_TOOL_LABEL_VISION_SOURCE: z.enum(['original', 'thumbnail']).default('original'),

  /**
   * true のとき、初見 1 回目のみ: 厳しめのサンプリング既定・追加回答ルール・厳格な正規化を適用
   * （2 回目シャドー／assist の経路は従来どおり INFERENCE_PHOTO_LABEL_VISION_*）
   */
  PHOTO_TOOL_LABEL_FIRST_PASS_STRICT_MODE: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  PHOTO_TOOL_LABEL_FIRST_PASS_VISION_MAX_TOKENS: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'string' && v.trim() === '') return undefined;
      return v;
    },
    z.coerce.number().int().min(16).max(4096).optional()
  ),
  PHOTO_TOOL_LABEL_FIRST_PASS_VISION_TEMPERATURE: z.preprocess(
    (v) => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === 'string' && v.trim() === '') return undefined;
      return v;
    },
    z.coerce.number().min(0).max(2).optional()
  ),

  /** 写真持出 GOOD ギャラリーの類似検索: 埋め込みAPIを有効化 */
  PHOTO_TOOL_EMBEDDING_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  PHOTO_TOOL_EMBEDDING_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  PHOTO_TOOL_EMBEDDING_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  PHOTO_TOOL_EMBEDDING_MODEL_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  PHOTO_TOOL_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  /** DB の vector(512) と一致させること */
  PHOTO_TOOL_EMBEDDING_DIMENSION: z.coerce.number().int().min(1).max(4096).default(512),
  PHOTO_TOOL_SIMILARITY_MAX_CANDIDATES: z.coerce.number().int().min(1).max(20).default(5),
  /** pgvector cosine distance（<=>）; 小さいほど類似。厳しめ既定 */
  PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE: z.coerce.number().min(0).max(2).default(0.22),
  /** 前処理変更時にギャラリー再計算の判断に使う */
  PHOTO_TOOL_SIMILARITY_PIPELINE_VERSION: z.string().default('vision_jpeg_v1'),

  /**
   * true かつ PHOTO_TOOL_EMBEDDING_ENABLED のとき、VLM 本番ラベルは従来どおり保存しつつ
   * 条件付きで補助プロンプトの 2 回目推論を実行してログ比較のみ行う（シャドー）
   */
  PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  /** 補助発火用: 管理 UI の類似候補より厳しめ（小さいほど類似のみ） */
  PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE: z.coerce.number().min(0).max(2).default(0.14),
  PHOTO_TOOL_LABEL_ASSIST_MIN_NEIGHBORS: z.coerce.number().int().min(1).max(20).default(2),
  /** 先頭 K 件の canonicalLabel がすべて一致するときだけ補助 */
  PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K: z.coerce.number().int().min(1).max(10).default(2),
  /** findNearestNeighbors の取得上限 */
  PHOTO_TOOL_LABEL_ASSIST_QUERY_NEIGHBOR_LIMIT: z.coerce.number().int().min(10).max(100).default(40),
  /** 補助プロンプトに載せるラベル数の上限（同一ラベルでも参照強調用に複数近傍があれば繰り返し可だが cap） */
  PHOTO_TOOL_LABEL_ASSIST_PROMPT_MAX_LABELS: z.coerce.number().int().min(1).max(10).default(3),

  /**
   * true かつ PHOTO_TOOL_EMBEDDING_ENABLED のとき、収束 canonical のギャラリー行数が
   * PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS 以上なら収束 canonical（正規化後）を photoToolDisplayName に保存しうる
   */
  PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  /** 収束ラベルと BTRIM 一致する photo_tool_similarity_gallery 行数の下限（マイルド既定 5） */
  PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS: z.coerce.number().int().min(1).max(100).default(5),
}).superRefine((value, ctx) => {
  if (value.LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED) {
    if (value.LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR >= value.LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR'],
        message:
          'LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR must be greater than LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR when warm window is enabled',
      });
    }
  }

  if (value.PHOTO_TOOL_EMBEDDING_ENABLED) {
    if (!value.PHOTO_TOOL_EMBEDDING_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PHOTO_TOOL_EMBEDDING_URL'],
        message: 'PHOTO_TOOL_EMBEDDING_URL is required when PHOTO_TOOL_EMBEDDING_ENABLED=true',
      });
    }
    if (!value.PHOTO_TOOL_EMBEDDING_MODEL_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PHOTO_TOOL_EMBEDDING_MODEL_ID'],
        message: 'PHOTO_TOOL_EMBEDDING_MODEL_ID is required when PHOTO_TOOL_EMBEDDING_ENABLED=true',
      });
    }
  }

  const parsedProviders = parseInferenceProvidersJsonQuiet(value.INFERENCE_PROVIDERS_JSON);
  if (parsedProviders && parsedProviders.length > 0) {
    for (const issue of collectLocalLlmProviderAlignmentIssues(parsedProviders, {
      LOCAL_LLM_BASE_URL: value.LOCAL_LLM_BASE_URL,
      LOCAL_LLM_SHARED_TOKEN: value.LOCAL_LLM_SHARED_TOKEN,
      LOCAL_LLM_MODEL: value.LOCAL_LLM_MODEL,
      LOCAL_LLM_RUNTIME_MODE: value.LOCAL_LLM_RUNTIME_MODE,
      LOCAL_LLM_RUNTIME_CONTROL_START_URL: value.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
      LOCAL_LLM_RUNTIME_CONTROL_STOP_URL: value.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
      LOCAL_LLM_RUNTIME_CONTROL_TOKEN: value.LOCAL_LLM_RUNTIME_CONTROL_TOKEN,
      INFERENCE_ADMIN_PROVIDER_ID: value.INFERENCE_ADMIN_PROVIDER_ID,
      INFERENCE_ADMIN_MODEL: value.INFERENCE_ADMIN_MODEL,
      INFERENCE_PHOTO_LABEL_PROVIDER_ID: value.INFERENCE_PHOTO_LABEL_PROVIDER_ID,
      INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID: value.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID,
    })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.path as string[],
        message: issue.message,
      });
    }
  }

  if (value.NODE_ENV !== 'production') {
    return;
  }

  if (isWeakSecret(value.JWT_ACCESS_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_ACCESS_SECRET'],
      message: `JWT_ACCESS_SECRET must be a strong secret (min ${SECRET_MIN_LENGTH} chars, no weak patterns) in production`,
    });
  }

  if (isWeakSecret(value.JWT_REFRESH_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_REFRESH_SECRET'],
      message: `JWT_REFRESH_SECRET must be a strong secret (min ${SECRET_MIN_LENGTH} chars, no weak patterns) in production`,
    });
  }
});

export const env = envSchema.parse(process.env);
