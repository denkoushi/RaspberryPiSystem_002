/**
 * @deprecated 直接利用は推奨しない。推論基盤は `getInferenceRuntime().createVisionCompletionPort()` を使用。
 * 後方互換のための薄いラッパー。
 */

import { getInferenceRuntime } from '../inference/inference-runtime.js';

import type { VisionCompletionPort, VisionCompletionInput, VisionCompletionResult } from '../inference/ports/vision-completion.port.js';

export class LlamaServerVisionCompletionAdapter implements VisionCompletionPort {
  private readonly inner: VisionCompletionPort;

  constructor(inner?: VisionCompletionPort) {
    this.inner = inner ?? getInferenceRuntime().createVisionCompletionPort();
  }

  async complete(input: VisionCompletionInput): Promise<VisionCompletionResult> {
    return this.inner.complete(input);
  }
}

export function isLocalLlmVisionConfigured(): boolean {
  return getInferenceRuntime().isPhotoLabelInferenceConfigured();
}
