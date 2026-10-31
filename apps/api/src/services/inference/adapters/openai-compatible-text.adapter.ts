import { createTimeoutSignal } from '../../../lib/timeout-signal.js';
import { emitInferenceCallOutcome } from '../observability/inference-observability.js';
import { InferenceRouter } from '../routing/inference-router.js';

import { type TextCompletionPort, type TextCompletionRequest, type TextCompletionResult, InferenceDeferredError } from '../ports/text-completion.port.js';
import { extractTextFromOpenAiStylePayload, type OpenAiStyleChatResponse } from './openai-chat-response.util.js';

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
    if (request.background && model !== 'system-prod-primary') throw new Error('Background admission requires the DGX model alias');
    const inputSize = inputSizeForMessages(request.messages);
    let result: 'ok' | 'failure' = 'failure';
    let errorReason: string | undefined;
    let outputSize = 0;

    const { signal, cleanup } = createTimeoutSignal(request.timeoutMs ?? provider.timeoutMs);
    try {
      const response = await this.deps.fetchImpl(new URL('/v1/chat/completions', provider.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LLM-Token': provider.sharedToken,
        },
        body: JSON.stringify({
          model: request.background ? 'dgx-background-preparation' : model,
          ...(request.jsonOutput ? { response_format: { type: 'json_object' } } : {}),
          messages: request.messages,
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          chat_template_kwargs: {
            enable_thinking: request.enableThinking,
          },
        }),
        signal: request.signal ? AbortSignal.any([signal, request.signal]) : signal,
      });

      if (!response.ok) {
        if (request.background && [429, 503].includes(response.status)) throw new InferenceDeferredError();
        errorReason = `upstream_http_${response.status}`;
        throw new Error(`Inference text upstream error: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as OpenAiStyleChatResponse;
      const finishReason = typeof payload.choices?.[0]?.finish_reason === 'string'
        ? payload.choices[0].finish_reason : undefined;
      const rawText = extractTextFromOpenAiStylePayload(payload) ?? '';
      if (!rawText && !(request.useCase === 'security_review' && finishReason === 'length')) {
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
      return { rawText, model, ...(finishReason === undefined ? {} : { finishReason }) };
    } catch (e) {
      if (signal.aborted || (e instanceof Error && e.name === 'TimeoutError')) {
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
      if (signal.aborted && !request.signal?.aborted) throw new DOMException('Inference call timed out', 'TimeoutError');
      throw e;
    } finally {
      cleanup();
    }
  }
}
