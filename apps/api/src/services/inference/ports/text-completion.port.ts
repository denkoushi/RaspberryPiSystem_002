import type { InferenceUseCase } from '../types/inference-usecase.js';

export type TextChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type TextCompletionRequest = {
  useCase: InferenceUseCase;
  messages: TextChatMessage[];
  maxTokens: number;
  temperature: number;
  enableThinking: boolean;
  signal?: AbortSignal;
  jsonOutput?: boolean;
  background?: boolean;
  /** Override the provider timeout for this request only. */
  timeoutMs?: number;
};

export class InferenceDeferredError extends Error {
  constructor() { super('DGX background admission deferred'); this.name = 'InferenceDeferredError'; }
}

export type TextCompletionResult = {
  rawText: string;
  model: string;
  finishReason?: string;
};

/**
 * テキストチャット completion（OpenAI 互換想定）
 */
export interface TextCompletionPort {
  complete(request: TextCompletionRequest): Promise<TextCompletionResult>;
}
