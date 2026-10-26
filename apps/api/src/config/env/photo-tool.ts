import { z } from 'zod';

export const photoToolEnvShape = {
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
} as const;
