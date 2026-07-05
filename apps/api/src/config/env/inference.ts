import { z } from 'zod';

export const inferenceEnvShape = {
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

  /**
   * true のとき on_demand /start に modelProfileId を載せる（opt-in）。
   * 既定 false: 従来どおり { reason } のみ。
   */
  INFERENCE_RUNTIME_START_PROFILE_ENABLED: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  /**
   * 業務機能全体で共有する DGX modelProfileId（photo_label / document_summary / admin / stackchan）。
   * 設定時は用途別 *_RUNTIME_START_PROFILE_ID と一致させること。
   */
  INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).max(128).optional()
  ),
  /** 用途別 DGX modelProfileId 意図（shadow ログ / opt-in start）。未設定時は送信しない。 */
  INFERENCE_PHOTO_LABEL_RUNTIME_START_PROFILE_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).max(128).optional()
  ),
  INFERENCE_DOCUMENT_SUMMARY_RUNTIME_START_PROFILE_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).max(128).optional()
  ),
  INFERENCE_ADMIN_RUNTIME_START_PROFILE_ID: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).max(128).optional()
  ),
  /** 要領書要約の system プロンプト上書き（未設定時はコード内デフォルト） */
  INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /** StackChan チャットの system プロンプト上書き（未設定時はコード内デフォルト） */
  INFERENCE_STACKCHAN_SYSTEM_PROMPT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /** orchestration 由来の business modelProfileId 意図を JSON で永続化するパス（未設定時はメモリのみ） */
  INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
} as const;
