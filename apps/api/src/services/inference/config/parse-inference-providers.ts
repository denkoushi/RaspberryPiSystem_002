import { z } from 'zod';

import { logger } from '../../../lib/logger.js';

import type { InferenceProviderDefinition } from './inference-provider.types.js';

const runtimeControlSchema = z.object({
  mode: z.enum(['always_on', 'on_demand']),
  startUrl: z.string().url().optional(),
  stopUrl: z.string().url().optional(),
  controlToken: z.string().min(1).optional(),
  healthBaseUrl: z.string().url().optional(),
});

const providerSchema = z.object({
  id: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  sharedToken: z.string().min(1),
  timeoutMs: z.coerce.number().int().min(1000).max(300000).optional(),
  defaultModel: z.string().min(1),
  runtimeControl: runtimeControlSchema.optional(),
});

const providersArraySchema = z.array(providerSchema).min(1).max(16);

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
  if (!raw || raw.trim() === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const rows = providersArraySchema.parse(parsed);
    return rows.map((r) => ({
      id: r.id,
      baseUrl: r.baseUrl,
      sharedToken: r.sharedToken,
      timeoutMs: r.timeoutMs ?? 60_000,
      defaultModel: r.defaultModel,
      runtimeControl: r.runtimeControl
        ? {
            mode: r.runtimeControl.mode,
            startUrl: r.runtimeControl.startUrl,
            stopUrl: r.runtimeControl.stopUrl,
            controlToken: r.runtimeControl.controlToken,
            healthBaseUrl: r.runtimeControl.healthBaseUrl,
          }
        : undefined,
    }));
  } catch (err) {
    logger.warn({ err }, '[Inference] INFERENCE_PROVIDERS_JSON parse failed, falling back to LOCAL_LLM_*');
    return null;
  }
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
