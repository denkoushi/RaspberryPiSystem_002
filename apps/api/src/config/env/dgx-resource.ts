import { z } from 'zod';

export const dgxResourceEnvShape = {
  /**
   * DGXリソース管理UI: オプション。GET で JSON を返すメトリクス集約URL（Pi5 から到達可能な場所に置く）。
   * 例: { "gpuUtilPct": 64, "unifiedMemoryUsedGiB": 92, "unifiedMemoryTotalGiB": 128, "freeMemoryGiB": 36 }
   */
  DGX_RESOURCE_METRICS_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  /** ComfyUI 等の疎通確認用（GET が 200 なら running 扱い）。未設定なら unknown */
  DGX_RESOURCE_COMFYUI_HEALTH_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  /** embedding など追加プローブ用。相対パスのとき admin LocalLLM baseUrl を prefix にする */
  DGX_RESOURCE_EMBEDDING_HEALTH_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().min(1).optional()
  ),
  /**
   * DGX Spark ホスト状態の簡易疎通（GET）。200 応答なら監視対象ホスト側エージェントが生存している前提。
   * 未設定時は監視ペインは unknown のまま（Runbook の例: メトリクス sidecar が返す軽い /health）。
   */
  DGX_RESOURCE_SPARK_HOST_STATUS_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_PROBE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10_000),
  DGX_RESOURCE_EVENT_LOG_MAX: z.coerce.number().int().min(10).max(500).default(50),
  /**
   * 私用 ComfyUI を Pi5 から起停するための POST URL（省略時は private-comfyui は読取のみ）。
   * gateway の /start|/stop と同様、`X-Runtime-Control-Token` にトークンを付与する。
   */
  DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  /**
   * 実験用ラボ（単一論理ターゲット experiment-lab）の起停用 URL と任意ヘルス。
   */
  DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_STOP_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_CONTROL_TOKEN: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional()
  ),
  /**
   * Agent 用コンテナ（Control Target `agent-container`）の起停と任意ヘルス。
   * 未設定時は API は読取のみ・ランタイムキューも agent 専用経路は無効（既存契約を維持）。
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
  /** 補助ランタイム（Comfy・実験・agent-container）POST /start|/stop に使うタイムアウト */
  DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(90_000),
} as const;
