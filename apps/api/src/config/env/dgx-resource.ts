import { z } from 'zod/v3';

export const dgxResourceEnvShape = {
  /**
   * DGXリソース管理UI: オプション。GET で JSON を返すメトリクス集約URL（Pi5 から到達可能な場所に置く）。
   * 例: { "gpuUtilPct": 64, "unifiedMemoryUsedGiB": 92, "unifiedMemoryTotalGiB": 128, "freeMemoryGiB": 36 }
   */
  DGX_RESOURCE_METRICS_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_PROBE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10_000),
  DGX_RESOURCE_EVENT_LOG_MAX: z.coerce.number().int().min(10).max(500).default(50),
  /**
   * Agent 用コンテナの起停 URL。DGXリソース画面からは使わない（ADR-20261017）。
   * 推論ランタイムの agent 専用経路だけが読む。未設定時はその経路は無効。
   */
  DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_STOP_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_CONTROL_TOKEN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
} as const;
