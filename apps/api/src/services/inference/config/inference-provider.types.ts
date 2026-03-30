/**
 * 推論プロバイダ1件の定義（OpenAI 互換 /v1/chat/completions 前提）
 */
export type InferenceProviderDefinition = {
  id: string;
  baseUrl: string;
  sharedToken: string;
  timeoutMs: number;
  /** 用途別 model 未指定時の既定 */
  defaultModel: string;
};
