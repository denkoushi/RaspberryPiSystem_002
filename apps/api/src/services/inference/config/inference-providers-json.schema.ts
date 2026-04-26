import { z } from 'zod';

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

/**
 * INFERENCE_PROVIDERS_JSON をパースする（logger に依存しない）。
 * env.ts の起動時検証で使う。失敗時は null。
 */
export function parseInferenceProvidersJsonQuiet(raw: string | undefined): InferenceProviderDefinition[] | null {
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
  } catch {
    return null;
  }
}
