import { ApiError } from '../../lib/errors.js';

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
};

type LocalLlmUpstreamResponse = {
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
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

const normalizeChatCompletionResponse = (
  payload: LocalLlmUpstreamResponse,
  fallbackModel: string
): LocalLlmChatCompletionResult => {
  const firstChoice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  const content = firstChoice?.message?.content;
  if (typeof content !== 'string') {
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
      const config = deps.getConfig();
      if (!config.configured || !config.baseUrl) {
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
        return {
          configured: true,
          baseUrl: config.baseUrl,
          model: config.model,
          timeoutMs: config.timeoutMs,
          health: {
            ok: response.ok,
            statusCode: response.status,
            body,
          },
        };
      } catch (error) {
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
        return normalizeChatCompletionResponse(payload, config.model);
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
    },
  };
}
