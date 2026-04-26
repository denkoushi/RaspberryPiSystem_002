/**
 * 推論プロバイダ1件の定義（OpenAI 互換 /v1/chat/completions 前提）
 */
export type InferenceProviderRuntimeControlDefinition = {
  mode: 'always_on' | 'on_demand';
  startUrl?: string;
  stopUrl?: string;
  controlToken?: string;
  healthBaseUrl?: string;
};

export type InferenceProviderDefinition = {
  id: string;
  baseUrl: string;
  sharedToken: string;
  timeoutMs: number;
  /** 用途別 model 未指定時の既定 */
  defaultModel: string;
  /** provider ごとの runtime 制御設定（未指定時は always_on 扱い） */
  runtimeControl?: InferenceProviderRuntimeControlDefinition;
};
