import './load-dotenv.js';

import { z } from 'zod';

const strictBooleanFromEnvironment = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}, z.boolean());

export const signageEnvShape = {
  // Candidate validation must not start Chromium/signage work. Production
  // remains enabled by default; the host-local deploy endpoint may pause the
  // live scheduler around the bounded candidate build.
  SIGNAGE_RENDER_ENABLED: strictBooleanFromEnvironment.default(true),
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
  // Optional dedicated credential for the host-local deploy endpoint. Existing
  // installations use the protected access secret during the first rollout.
  DEPLOY_CONTROL_TOKEN: z.string().min(1).optional(),
} as const;
