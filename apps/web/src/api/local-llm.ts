import { api } from './client';
import { getApiErrorMessageWithCode } from './errors';

import type { LocalLlmChatCompletionResult, LocalLlmChatRequestBody, LocalLlmStatus } from './local-llm.types';

export const LOCAL_LLM_STATUS_PATH = '/system/local-llm/status';
export const LOCAL_LLM_CHAT_PATH = '/system/local-llm/chat/completions';

/**
 * GET status。200（利用可）と 503（未設定/ヘルス NG）の両方で JSON 本文を返す。
 */
export async function getLocalLlmStatus(): Promise<{ httpStatus: number; body: LocalLlmStatus }> {
  const res = await api.get<LocalLlmStatus>(LOCAL_LLM_STATUS_PATH, {
    validateStatus: (s) => s === 200 || s === 503,
  });
  return { httpStatus: res.status, body: res.data };
}

export async function postLocalLlmChatCompletion(
  body: LocalLlmChatRequestBody
): Promise<LocalLlmChatCompletionResult> {
  const { data } = await api.post<LocalLlmChatCompletionResult>(LOCAL_LLM_CHAT_PATH, body);
  return data;
}

export function getLocalLlmApiErrorMessage(error: unknown): string {
  return getApiErrorMessageWithCode(error);
}
