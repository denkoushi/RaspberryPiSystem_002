/**
 * Pi5 API LocalLLM 代理のクライアント契約（Web 専用）。
 * サーバ実体: apps/api/src/services/system/local-llm-proxy.service.ts
 */

export type LocalLlmChatMessageRole = 'system' | 'user' | 'assistant';

export type LocalLlmChatMessage = {
  role: LocalLlmChatMessageRole;
  content: string;
};

export type LocalLlmUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LocalLlmChatCompletionResult = {
  model: string;
  content: string;
  finishReason?: string;
  usage?: LocalLlmUsage;
};

export type LocalLlmStatus = {
  configured: boolean;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
  health: {
    ok: boolean;
    statusCode?: number;
    body?: string;
    error?: string;
  };
};

export type LocalLlmChatRequestBody = {
  messages: LocalLlmChatMessage[];
  maxTokens: number;
  temperature: number;
  enableThinking: boolean;
};
