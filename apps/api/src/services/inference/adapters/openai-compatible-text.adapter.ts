import { emitInferenceCallOutcome } from '../observability/inference-observability.js';
import { InferenceRouter } from '../routing/inference-router.js';

import type { TextCompletionPort, TextCompletionRequest, TextCompletionResult } from '../ports/text-completion.port.js';
import { extractTextFromOpenAiStylePayload, type OpenAiStyleChatResponse } from './openai-chat-response.util.js';

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

function inputSizeForMessages(messages: TextCompletionRequest['messages']): number {
  return messages.reduce((acc, m) => acc + Buffer.byteLength(m.content, 'utf8'), 0);
}

export type OpenAiCompatibleTextAdapterDeps = {
  router: InferenceRouter;
  fetchImpl: typeof fetch;
};

/**
 * OpenAI 互換 POST /v1/chat/completions へテキスト completion を送る。
 */
export class OpenAiCompatibleTextAdapter implements TextCompletionPort {
  constructor(private readonly deps: OpenAiCompatibleTextAdapterDeps) {}

  async complete(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const started = performance.now();
    const { provider, model } = this.deps.router.resolve(request.useCase);
    const inputSize = inputSizeForMessages(request.messages);
    let result: 'ok' | 'failure' = 'failure';
    let errorReason: string | undefined;
    let outputSize = 0;

    const { signal, cleanup } = createTimeoutSignal(provider.timeoutMs);
    try {
      const response = await this.deps.fetchImpl(new URL('/v1/chat/completions', provider.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Token': provider.sharedToken,
        },
        body: JSON.stringify({
          model,
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
        errorReason = `upstream_http_${response.status}`;
        throw new Error(`Inference text upstream error: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as OpenAiStyleChatResponse;
      const rawText = extractTextFromOpenAiStylePayload(payload);
      if (!rawText) {
        errorReason = 'missing_assistant_text';
        throw new Error('Inference text response missing assistant text');
      }
      result = 'ok';
      outputSize = Buffer.byteLength(rawText, 'utf8');
      emitInferenceCallOutcome({
        useCase: request.useCase,
        providerId: provider.id,
        model,
        latencyMs: Math.round(performance.now() - started),
        result,
        inputSize,
        outputSize,
      });
      return { rawText, model };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        errorReason = 'timeout';
      } else if (!errorReason) {
        errorReason = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
      }
      emitInferenceCallOutcome({
        useCase: request.useCase,
        providerId: provider.id,
        model,
        latencyMs: Math.round(performance.now() - started),
        result: 'failure',
        errorReason,
        inputSize,
        outputSize: 0,
      });
      throw e;
    } finally {
      cleanup();
    }
  }
}
