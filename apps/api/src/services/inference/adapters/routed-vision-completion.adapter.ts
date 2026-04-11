import type { VisionCompletionPort, VisionCompletionInput, VisionCompletionResult } from '../ports/vision-completion.port.js';
import { emitInferenceCallOutcome } from '../observability/inference-observability.js';
import { InferenceRouter } from '../routing/inference-router.js';
import type { InferenceUseCase } from '../types/inference-usecase.js';

import { extractTextFromOpenAiStylePayload, type OpenAiStyleChatResponse } from './openai-chat-response.util.js';

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

export type RoutedVisionCompletionAdapterDeps = {
  router: InferenceRouter;
  fetchImpl: typeof fetch;
  /** ルータが解決する推論用途（例: photo_label）。テキスト completion と同様に用途を注入する。 */
  useCase: InferenceUseCase;
  getMaxTokens: () => number;
  getTemperature: () => number;
};

/**
 * OpenAI 互換 VLM: 指定 useCase へルーティングし `/v1/chat/completions` を呼ぶ。
 */
export class RoutedVisionCompletionAdapter implements VisionCompletionPort {
  constructor(private readonly deps: RoutedVisionCompletionAdapterDeps) {}

  async complete(input: VisionCompletionInput): Promise<VisionCompletionResult> {
    const started = performance.now();
    const useCase = this.deps.useCase;
    const { provider, model } = this.deps.router.resolve(useCase);
    const inputSize = input.imageBytes.length + Buffer.byteLength(input.userText, 'utf8');
    let result: 'ok' | 'failure' = 'failure';
    let errorReason: string | undefined;
    let outputSize = 0;

    const dataUrl = `data:${input.mimeType};base64,${input.imageBytes.toString('base64')}`;
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
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: input.userText },
              ],
            },
          ],
          max_tokens: this.deps.getMaxTokens(),
          temperature: this.deps.getTemperature(),
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal,
      });

      if (!response.ok) {
        errorReason = `upstream_http_${response.status}`;
        throw new Error(`Inference vision upstream error: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as OpenAiStyleChatResponse;
      const rawText = extractTextFromOpenAiStylePayload(payload);
      if (!rawText) {
        errorReason = 'missing_assistant_text';
        throw new Error('Inference vision response missing assistant text');
      }
      result = 'ok';
      outputSize = Buffer.byteLength(rawText, 'utf8');
      emitInferenceCallOutcome({
        useCase,
        providerId: provider.id,
        model,
        latencyMs: Math.round(performance.now() - started),
        result,
        inputSize,
        outputSize,
      });
      return { rawText };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        errorReason = 'timeout';
      } else if (!errorReason) {
        errorReason = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
      }
      emitInferenceCallOutcome({
        useCase,
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
