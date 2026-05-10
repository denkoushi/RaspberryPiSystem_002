/**
 * Control Target: DGX リソース画面が束ねる「標準制御・監視対象」の契約。
 * SET_POLICY（運用ヒント）とは別レイヤー。
 */

export const DGX_CONTROL_TARGET_IDS = [
  'system-prod-gateway',
  'system-prod-inference',
  'system-prod-embedding',
  'private-comfyui',
  'experiment-lab',
  'agent-container',
  'spark-host',
  'metrics-kpi',
] as const;

export type DgxControlTargetId = (typeof DGX_CONTROL_TARGET_IDS)[number];

export type DgxControlTargetKind = 'gateway' | 'http_probe' | 'metrics_source';

/** クライアントが実行してよい操作（サーバ側でも再検証する） */
export type DgxControlTargetCapability = 'readStatus' | 'start' | 'stop';

export type DgxControlTargetAction = 'start' | 'stop';

export type DgxServiceStatusKind = 'running' | 'degraded' | 'stopped' | 'unknown';

export type DgxControlTargetSnapshot = {
  id: DgxControlTargetId;
  kind: DgxControlTargetKind;
  /** UI 見出し */
  displayName: string;
  capabilities: DgxControlTargetCapability[];
  status: DgxServiceStatusKind;
  badges: string[];
  metaLines: string[];
};
