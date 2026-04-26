import { ApiError } from '../../lib/errors.js';

import type { LocalLlmObservability } from './local-llm-observability.js';

export type LocalLlmChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LocalLlmChatRequest = {
  messages: LocalLlmChatMessage[];
  maxTokens: number;
  temperature: number;
  enableThinking: boolean;
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

export type LocalLlmRuntimeConfig = {
  configured: boolean;
  baseUrl?: string;
  sharedToken?: string;
  model?: string;
  timeoutMs: number;
};

export type LocalLlmGateway = {
  getStatus: () => Promise<LocalLlmStatus>;
  createChatCompletion: (request: LocalLlmChatRequest) => Promise<LocalLlmChatCompletionResult>;
};

type LocalLlmGatewayDeps = {
  getConfig: () => LocalLlmRuntimeConfig;
  fetchImpl: typeof fetch;
  observability: LocalLlmObservability;
};

type LocalLlmUpstreamResponse = {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
      reasoning?: unknown;
      reasoning_content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
};

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

const requireConfiguredLocalLlm = (config: LocalLlmRuntimeConfig): Required<LocalLlmRuntimeConfig> => {
  if (!config.configured || !config.baseUrl || !config.sharedToken || !config.model) {
    throw new ApiError(
      503,
      'LocalLLM が設定されていません',
      {
        configured: config.configured,
        hasBaseUrl: Boolean(config.baseUrl),
        hasSharedToken: Boolean(config.sharedToken),
        hasModel: Boolean(config.model),
      },
      'LOCAL_LLM_NOT_CONFIGURED'
    );
  }
  return config as Required<LocalLlmRuntimeConfig>;
};

const buildLocalLlmHeaders = (sharedToken: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-LLM-Token': sharedToken,
});

const trimErrorBody = (body: string): string => body.slice(0, 500);

const toOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

type LocalLlmUpstreamMessage = {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
};

const extractTextLikeField = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const texts = value
      .map((part) => {
        if (!part || typeof part !== 'object') {
          return '';
        }
        if ('text' in part && typeof (part as { text?: unknown }).text === 'string') {
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

const resolveAssistantContent = (message: LocalLlmUpstreamMessage | undefined): string | null => {
  if (!message) {
    return null;
  }
  return (
    extractTextLikeField(message.content) ??
    extractTextLikeField(message.reasoning) ??
    extractTextLikeField(message.reasoning_content)
  );
};

const normalizeChatCompletionResponse = (
  payload: LocalLlmUpstreamResponse,
  fallbackModel: string
): LocalLlmChatCompletionResult => {
  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  const content = resolveAssistantContent(firstChoice?.message);
  if (!content) {
    throw new ApiError(
      502,
      'LocalLLM の応答形式が不正です',
      { reason: 'assistant content missing' },
      'LOCAL_LLM_INVALID_RESPONSE'
    );
  }

  return {
    model: typeof payload.model === 'string' ? payload.model : fallbackModel,
    content,
    finishReason: typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : undefined,
    usage: payload.usage
      ? {
          promptTokens: toOptionalNumber(payload.usage.prompt_tokens),
          completionTokens: toOptionalNumber(payload.usage.completion_tokens),
          totalTokens: toOptionalNumber(payload.usage.total_tokens),
        }
      : undefined,
  };
};

export function createLocalLlmGateway(deps: LocalLlmGatewayDeps): LocalLlmGateway {
  return {
    async getStatus(): Promise<LocalLlmStatus> {
      const started = performance.now();
      const config = deps.getConfig();

      if (!config.configured || !config.baseUrl) {
        deps.observability.emitHealthCheckOutcome({
          durationMs: Math.round(performance.now() - started),
          configured: false,
          ok: false,
          result: 'not_configured',
        });
        return {
          configured: false,
          baseUrl: config.baseUrl,
          model: config.model,
          timeoutMs: config.timeoutMs,
          health: {
            ok: false,
            error: 'LocalLLM is not configured',
          },
        };
      }

      const { signal, cleanup } = createTimeoutSignal(config.timeoutMs);
      try {
        const response = await deps.fetchImpl(new URL('/healthz', config.baseUrl), {
          method: 'GET',
          signal,
        });
        const body = await response.text();
        const ok = response.ok;
        deps.observability.emitHealthCheckOutcome({
          durationMs: Math.round(performance.now() - started),
          configured: true,
          ok,
          statusCode: response.status,
          result: ok ? 'ok' : 'upstream_non_ok',
        });
        return {
          configured: true,
          baseUrl: config.baseUrl,
          model: config.model,
          timeoutMs: config.timeoutMs,
          health: {
            ok,
            statusCode: response.status,
            body,
          },
        };
      } catch (error) {
        deps.observability.emitHealthCheckOutcome({
          durationMs: Math.round(performance.now() - started),
          configured: true,
          ok: false,
          result: 'fetch_error',
        });
        return {
          configured: true,
          baseUrl: config.baseUrl,
          model: config.model,
          timeoutMs: config.timeoutMs,
          health: {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      } finally {
        cleanup();
      }
    },

    async createChatCompletion(request: LocalLlmChatRequest): Promise<LocalLlmChatCompletionResult> {
      const started = performance.now();
      let ok = false;
      let errorCode: string | undefined;
      let usage: LocalLlmUsage | undefined;

      try {
        const config = requireConfiguredLocalLlm(deps.getConfig());
        const { signal, cleanup } = createTimeoutSignal(config.timeoutMs);
        try {
          const response = await deps.fetchImpl(new URL('/v1/chat/completions', config.baseUrl), {
            method: 'POST',
            headers: buildLocalLlmHeaders(config.sharedToken),
            body: JSON.stringify({
              model: config.model,
              messages: request.messages,
              max_tokens: request.maxTokens,
              temperature: request.temperature,
              chat_template_kwargs: {
                enable_thinking: request.enableThinking,
              },
            }),
            signal,
          });

          if (!response.ok) {
            const errorText = trimErrorBody(await response.text());
            throw new ApiError(
              502,
              'LocalLLM からエラー応答が返されました',
              {
                status: response.status,
                body: errorText,
              },
              'LOCAL_LLM_UPSTREAM_ERROR'
            );
          }

          const payload = (await response.json()) as LocalLlmUpstreamResponse;
          const result = normalizeChatCompletionResponse(payload, config.model);
          ok = true;
          usage = result.usage;
          return result;
        } catch (error) {
          if (error instanceof ApiError) {
            throw error;
          }
          if (error instanceof Error && error.name === 'AbortError') {
            throw new ApiError(504, 'LocalLLM の応答がタイムアウトしました', undefined, 'LOCAL_LLM_TIMEOUT');
          }
          throw new ApiError(
            502,
            'LocalLLM への接続に失敗しました',
            {
              message: error instanceof Error ? error.message : 'Unknown error',
            },
            'LOCAL_LLM_REQUEST_FAILED'
          );
        } finally {
          cleanup();
        }
      } catch (error) {
        if (error instanceof ApiError) {
          errorCode = error.code;
        }
        throw error;
      } finally {
        deps.observability.emitChatCompletionOutcome({
          durationMs: Math.round(performance.now() - started),
          ok,
          errorCode,
          messageCount: request.messages.length,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          usage: ok ? usage : undefined,
        });
      }
    },
  };
}
