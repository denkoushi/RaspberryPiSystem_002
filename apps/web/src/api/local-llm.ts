import axios from 'axios';

import { api } from './client';

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

type ApiErrorPayload = {
  message?: string;
  errorCode?: string;
};

export function getLocalLlmApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const d = error.response?.data as ApiErrorPayload | undefined;
    if (typeof d?.message === 'string') {
      return d.errorCode ? `${d.message} (${d.errorCode})` : d.message;
    }
    if (error.response?.status === 403) {
      return 'この操作を行う権限がありません';
    }
  }
  return error instanceof Error ? error.message : '予期しないエラーが発生しました';
}
