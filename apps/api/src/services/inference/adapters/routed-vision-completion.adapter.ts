import type { VisionCompletionPort, VisionCompletionInput, VisionCompletionResult } from '../ports/vision-completion.port.js';
import { emitInferenceCallOutcome } from '../observability/inference-observability.js';
import { InferenceRouter } from '../routing/inference-router.js';
import type { InferenceUseCase } from '../types/inference-usecase.js';

import { extractTextFromOpenAiStylePayload, type OpenAiStyleChatResponse } from './openai-chat-response.util.js';
import {
  classifyVlmHttp400SubReason,
  isRetryableVlmImageHttp400,
  reencodeImageBufferForVlmFallback,
  type VlmReencodeOptions,
} from './vision-vlm-fallback.util.js';

const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

const trimErrorBody = (body: string): string => body.slice(0, 2000);

export type RoutedVisionCompletionAdapterDeps = {
  router: InferenceRouter;
  fetchImpl: typeof fetch;
  /** ルータが解決する推論用途（例: photo_label）。テキスト completion と同様に用途を注入する。 */
  useCase: InferenceUseCase;
  getMaxTokens: () => number;
  getTemperature: () => number;
  /**
   * DGX vLLM 等で画像デコード 400 時の再エンコード（テスト差し替え用）。
   * 未指定時は `reencodeImageBufferForVlmFallback`（sharp）を使う。
   */
  reencodeImageBufferForVlmFallback?: (
    imageBytes: Buffer,
    mimeType: string,
    options?: VlmReencodeOptions
  ) => Promise<Buffer>;
};

/**
 * OpenAI 互換 VLM: 指定 useCase へルーティングし `/v1/chat/completions` を呼ぶ。
 * 画像ロード/デコード系 400 のときだけ、JPEG 再エンコードで **最大 1 回** 再送する。
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

    const reencode = this.deps.reencodeImageBufferForVlmFallback ?? reencodeImageBufferForVlmFallback;

    const { signal, cleanup } = createTimeoutSignal(provider.timeoutMs);

    const postChat = (imageBytes: Buffer, mimeType: string) =>
      this.deps.fetchImpl(new URL('/v1/chat/completions', provider.baseUrl), {
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
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${imageBytes.toString('base64')}` },
                },
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

    const parseAndReturn = async (response: Response): Promise<VisionCompletionResult> => {
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
    };

    const assignUpstreamError = (status: number, errBody: string) => {
      if (status === 400) {
        const sub = classifyVlmHttp400SubReason(400, errBody);
        errorReason = `upstream_http_400_vlm_${sub}`;
      } else {
        errorReason = `upstream_http_${status}`;
      }
    };

    try {
      let response = await postChat(input.imageBytes, input.mimeType);

      if (response.ok) {
        return await parseAndReturn(response);
      }

      let errText = trimErrorBody(await response.text());

      if (response.status === 400 && isRetryableVlmImageHttp400(400, errText)) {
        try {
          const sub = classifyVlmHttp400SubReason(400, errText);
          const reencodeOpts: VlmReencodeOptions =
            sub === 'size'
              ? { maxEdge: 384, quality: 65 }
              : { maxEdge: 512, quality: 72 };
          const reencoded = await reencode(input.imageBytes, input.mimeType, reencodeOpts);
          response = await postChat(reencoded, 'image/jpeg');
          if (response.ok) {
            return await parseAndReturn(response);
          }
          errText = trimErrorBody(await response.text());
        } catch (re) {
          // 再エンコード失敗: errorReason のみ付与し、観測は外側の catch で 1 回だけ出す
          errorReason = 'vlm_image_reencode_failed';
          throw re;
        }
      }

      assignUpstreamError(response.status, errText);
      throw new Error(`Inference vision upstream error: HTTP ${response.status}`);
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
