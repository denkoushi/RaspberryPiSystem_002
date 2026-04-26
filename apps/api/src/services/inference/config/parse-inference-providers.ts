import { logger } from '../../../lib/logger.js';

import type { InferenceProviderDefinition } from './inference-provider.types.js';
import { parseInferenceProvidersJsonQuiet } from './inference-providers-json.schema.js';

export type LegacyLocalLlmShape = {
  baseUrl?: string;
  sharedToken?: string;
  model?: string;
  timeoutMs: number;
  runtimeMode?: 'always_on' | 'on_demand';
  runtimeControlStartUrl?: string;
  runtimeControlStopUrl?: string;
  runtimeControlToken?: string;
  runtimeHealthBaseUrl?: string;
};

/**
 * INFERENCE_PROVIDERS_JSON をパースする。失敗時は null。
 */
export function tryParseInferenceProvidersJson(raw: string | undefined): InferenceProviderDefinition[] | null {
  const parsed = parseInferenceProvidersJsonQuiet(raw);
  if (parsed === null && raw && raw.trim() !== '') {
    logger.warn('[Inference] INFERENCE_PROVIDERS_JSON parse failed, falling back to LOCAL_LLM_*');
  }
  return parsed;
}

/**
 * LOCAL_LLM_* から id=default の1プロバイダを合成する。
 */
export function synthesizeProvidersFromLegacyLlm(legacy: LegacyLocalLlmShape): InferenceProviderDefinition[] {
  if (!legacy.baseUrl || !legacy.sharedToken || !legacy.model) {
    return [];
  }
  return [
    {
      id: 'default',
      baseUrl: legacy.baseUrl,
      sharedToken: legacy.sharedToken,
      timeoutMs: legacy.timeoutMs,
      defaultModel: legacy.model,
      runtimeControl:
        legacy.runtimeMode === 'on_demand'
          ? {
              mode: 'on_demand',
              startUrl: legacy.runtimeControlStartUrl,
              stopUrl: legacy.runtimeControlStopUrl,
              controlToken: legacy.runtimeControlToken,
              healthBaseUrl: legacy.runtimeHealthBaseUrl ?? legacy.baseUrl,
            }
          : legacy.runtimeMode === 'always_on'
            ? {
                mode: 'always_on',
              }
            : undefined,
    },
  ];
}
