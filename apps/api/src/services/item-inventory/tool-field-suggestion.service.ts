import { z } from 'zod';

import { logger } from '../../lib/logger.js';
import { PhotoStorage } from '../../lib/photo-storage.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import type { VisionCompletionPort } from '../inference/ports/vision-completion.port.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';

const resultSchema = z.object({ model: z.array(z.string()), maker: z.array(z.string()) });
const instruction = '工具またはケース・ラベルに印刷・刻印された文字だけを読んでください。型式は確からしい順に最大3件、メーカーは最大2件。読めなければ空配列。推測は禁止。JSONだけを返してください: {"model": string[], "maker": string[]}';
const clean = (values: string[], limit: number) => [...new Set(values.map(value => value.trim()).filter(value => value.length > 0 && value.length <= 80))].slice(0, limit);
export type ToolFieldSuggestion = { model: string[]; maker: string[]; status: 'ok' | 'unavailable' };

export class ToolFieldSuggestionService {
  constructor(private readonly vision?: VisionCompletionPort, private readonly timeoutMs = 30000) {}

  async suggest(photoUrl: string, signal?: AbortSignal): Promise<ToolFieldSuggestion> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, this.timeoutMs);
    let runtime: ReturnType<typeof getLocalLlmRuntimeController> | undefined;
    let held = false;
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Suggestion aborted')), { once: true });
      if (controller.signal.aborted) reject(new Error('Suggestion aborted'));
    });
    try {
      const work = async () => {
        controller.signal.throwIfAborted();
        const imageBytes = await PhotoStorage.readVisionInferenceJpeg(photoUrl, { maxLongEdge: 1280, jpegQuality: 85 });
        controller.signal.throwIfAborted();
        runtime = getLocalLlmRuntimeController();
        await runtime.ensureReady('photo_label');
        // Readiness may finish after the caller's deadline; release that late acquisition too.
        if (controller.signal.aborted) { await runtime.release('photo_label'); controller.signal.throwIfAborted(); }
        held = true;
        const result = await (this.vision ?? getInferenceRuntime().createVisionCompletionPort()).complete({
          userText: instruction, imageBytes, mimeType: 'image/jpeg', temperature: 0,
          maxTokens: 300, jsonOutput: true, timeoutMs: this.timeoutMs, signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        const parsed = resultSchema.parse(JSON.parse(result.rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
        return { model: clean(parsed.model, 3), maker: clean(parsed.maker, 2), status: 'ok' as const };
      };
      return await Promise.race([work(), cancelled]);
    } catch {
      // ADR-20260402: never log images, model output, recognised text or upstream error bodies.
      logger.warn({ status: 'unavailable', aborted: controller.signal.aborted }, 'inventory_tool_field_suggestion_unavailable');
      return { model: [], maker: [], status: 'unavailable' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (held && runtime) {
        // Cleanup must not turn an optional suggestion into a registration failure.
        void runtime.release('photo_label').catch(() => logger.warn({ status: 'unavailable' }, 'inventory_tool_field_suggestion_release_failed'));
      }
    }
  }
}
