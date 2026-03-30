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
};

export type TextCompletionResult = {
  rawText: string;
  model: string;
};

/**
 * テキストチャット completion（OpenAI 互換想定）
 */
export interface TextCompletionPort {
  complete(request: TextCompletionRequest): Promise<TextCompletionResult>;
}
