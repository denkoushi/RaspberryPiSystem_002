/**
 * llama-server（OpenAI 互換 `/v1/chat/completions`）向け VLM 呼び出し。
 *
 * マルチモーダル `messages[].content` の JSON 形は llama.cpp のビルドにより差があり得る。
 * 本アダプタは一般的な `image_url` + `text` 形式を送る。実機とずれる場合はこのファイルのみ調整する。
 */

import { env } from '../../config/env.js';

import type { VisionCompletionPort, VisionCompletionInput, VisionCompletionResult } from '../tools/photo-tool-label/photo-tool-label-ports.js';

type LocalLlmRuntimeConfig = {
  configured: boolean;
  baseUrl?: string;
  sharedToken?: string;
  model?: string;
  timeoutMs: number;
};

type UpstreamChoiceMessage = {
  content?: unknown;
};

type UpstreamResponse = {
  choices?: Array<{
    message?: UpstreamChoiceMessage;
  }>;
};

const getRuntimeConfig = (): LocalLlmRuntimeConfig => ({
  configured: Boolean(env.LOCAL_LLM_BASE_URL && env.LOCAL_LLM_SHARED_TOKEN && env.LOCAL_LLM_MODEL),
  baseUrl: env.LOCAL_LLM_BASE_URL,
  sharedToken: env.LOCAL_LLM_SHARED_TOKEN,
  model: env.LOCAL_LLM_MODEL,
  timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
});

const extractTextFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    const t = content.trim();
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(content)) {
    const texts = content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean);
    const joined = texts.join(' ').trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
};

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

export class LlamaServerVisionCompletionAdapter implements VisionCompletionPort {
  constructor(
    private readonly deps: {
      getConfig: () => LocalLlmRuntimeConfig;
      fetchImpl: typeof fetch;
    } = { getConfig: getRuntimeConfig, fetchImpl: fetch }
  ) {}

  async complete(input: VisionCompletionInput): Promise<VisionCompletionResult> {
    const config = this.deps.getConfig();
    if (!config.configured || !config.baseUrl || !config.sharedToken || !config.model) {
      throw new Error('LocalLLM is not configured for vision completion');
    }

    const dataUrl = `data:${input.mimeType};base64,${input.imageBytes.toString('base64')}`;
    const { signal, cleanup } = createTimeoutSignal(config.timeoutMs);
    try {
      const response = await this.deps.fetchImpl(new URL('/v1/chat/completions', config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Token': config.sharedToken,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: input.userText },
              ],
            },
          ],
          max_tokens: 64,
          temperature: 0.2,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal,
      });

      if (!response.ok) {
        const snippet = (await response.text()).slice(0, 200);
        throw new Error(`LocalLLM upstream error: HTTP ${response.status} ${snippet}`);
      }

      const payload = (await response.json()) as UpstreamResponse;
      const first = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
      const rawText = extractTextFromMessageContent(first?.message?.content);
      if (!rawText) {
        throw new Error('LocalLLM vision response missing assistant text');
      }
      return { rawText };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('LocalLLM vision request timed out');
      }
      throw error;
    } finally {
      cleanup();
    }
  }
}

export function isLocalLlmVisionConfigured(): boolean {
  return getRuntimeConfig().configured;
}
