import { z } from 'zod';

export const localLlmEnvShape = {
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
   * true のとき、業務/Agent以外の用途に対してのみ warm 窓で release 後も /stop を送らない。
   * 業務/Agent用途（photo_label / document_summary / admin_console_chat / stackchan_chat / agent_container_task）は常に停止抑止（ポリシーモジュール）。
   * 既定 false なら「それ以外」では従来どおり refCount=0 で停止試行。
   */
  LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  LOCAL_LLM_RUNTIME_WARM_WINDOW_TIMEZONE: z.string().min(1).default('Asia/Tokyo'),
  /** warm 窓の開始時（この時を含む。0–23） */
  LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  /** warm 窓の終了時（この時を含まない。0–23）。07–23 なら 07:00〜22:59 が warm */
  LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR: z.coerce.number().int().min(0).max(23).default(23),
} as const;
