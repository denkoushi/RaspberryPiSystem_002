import type { OverlayBBox } from '@raspi-system/shared-types';
import sharp from 'sharp';
import { z } from 'zod';

import { logger } from '../../lib/logger.js';
import { PhotoStorage } from '../../lib/photo-storage.js';
import { cropImageRegionRoi } from '../image-region/image-region-roi.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import type { VisionCompletionPort } from '../inference/ports/vision-completion.port.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';

const resultSchema = z.object({ candidates: z.array(z.string()) }).strict();
const instruction = '写真の枠内に写っている文字を行ごとに書き起こしてください。印刷・刻印された文字だけを読み、推測や説明はしないでください。読めなければ空配列。最大5件、各120文字まで。JSONだけを返してください: {"candidates": string[]}';
export type PhotoRegionReadResult = { candidates: string[]; status: 'ok' | 'unavailable' };

function parseCandidates(rawText: string): string[] {
  try {
    const parsed = resultSchema.safeParse(JSON.parse(rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
    if (!parsed.success) return [];
    return [...new Set(parsed.data.candidates.map(value => value.trim().slice(0, 120)).filter(Boolean))].slice(0, 5);
  } catch { return []; }
}

export class PhotoRegionReadService {
  constructor(private readonly vision?: VisionCompletionPort, private readonly timeoutMs = 30000) {}

  async read(photoUrl: string, bbox: OverlayBBox, signal?: AbortSignal): Promise<PhotoRegionReadResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, this.timeoutMs);
    let runtime: ReturnType<typeof getLocalLlmRuntimeController> | undefined;
    let held = false;
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Region read aborted')), { once: true });
      if (controller.signal.aborted) reject(new Error('Region read aborted'));
    });
    try {
      const work = async () => {
        controller.signal.throwIfAborted();
        // Crop the original before resizing so small labels keep their detail.
        // Like suggest-tool-fields, do not apply EXIF auto-rotation.
        const source = await PhotoStorage.readPhoto(photoUrl);
        controller.signal.throwIfAborted();
        const cropped = await cropImageRegionRoi(source, bbox);
        const imageBytes = await sharp(cropped.buffer).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        controller.signal.throwIfAborted();
        runtime = getLocalLlmRuntimeController();
        await runtime.ensureReady('photo_label');
        // Readiness may finish after the caller's deadline; release that late acquisition too.
        if (controller.signal.aborted) { await runtime.release('photo_label'); controller.signal.throwIfAborted(); }
        held = true;
        const result = await (this.vision ?? getInferenceRuntime().createVisionCompletionPort()).complete({
          userText: instruction, imageBytes, mimeType: 'image/jpeg', temperature: 0,
          maxTokens: 1000, jsonOutput: true, timeoutMs: this.timeoutMs, signal: controller.signal,
        });
        controller.signal.throwIfAborted();
        return { candidates: parseCandidates(result.rawText), status: 'ok' as const };
      };
      return await Promise.race([work(), cancelled]);
    } catch {
      // ADR-20260402: never log images, model output, recognised text or upstream error bodies.
      logger.warn({ status: 'unavailable', aborted: controller.signal.aborted }, 'inventory_photo_region_read_unavailable');
      return { candidates: [], status: 'unavailable' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (held && runtime) {
        // Cleanup must not turn an optional suggestion into a registration failure.
        void runtime.release('photo_label').catch(() => logger.warn({ status: 'unavailable' }, 'inventory_photo_region_read_release_failed'));
      }
    }
  }
}
