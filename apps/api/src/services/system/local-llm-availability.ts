import { env } from '../../config/env.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { verifyBusinessRuntimeAfterProfileStart } from '../inference/config/business-runtime-readiness.js';
import { resolveRuntimeStartProfileIdForUseCase } from '../inference/config/inference-use-case-runtime-intent.js';

import { probeHttpOk } from './dgx-resource/dgx-resource.probes.js';

/** Read-only snapshot: never acquire a runtime lease or invoke its start path. */
export async function probeBusinessLocalLlmAvailability(): Promise<boolean> {
  try {
    const runtime = getInferenceRuntime();
    const { provider, model } = runtime.router.resolve('business_hermes');
    if (!provider.baseUrl?.trim() || !provider.sharedToken?.trim() || !model?.trim()) return false;

    const legacyRuntimeControl = runtime.getAdminProvider()?.id === provider.id &&
      (env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim() || env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim())
      ? { mode: 'on_demand' as const, healthBaseUrl: env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL }
      : undefined;
    const runtimeControl = provider.runtimeControl ?? legacyRuntimeControl;
    const healthBaseUrl = runtimeControl?.healthBaseUrl?.trim() || provider.baseUrl;
    const runtimeIntent = {
      runtimeStartProfileEnabled: env.INFERENCE_RUNTIME_START_PROFILE_ENABLED,
      businessRuntimeStartProfileId: env.INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID,
      photoLabelRuntimeStartProfileId: env.INFERENCE_PHOTO_LABEL_RUNTIME_START_PROFILE_ID,
      documentSummaryRuntimeStartProfileId: env.INFERENCE_DOCUMENT_SUMMARY_RUNTIME_START_PROFILE_ID,
      adminRuntimeStartProfileId: env.INFERENCE_ADMIN_RUNTIME_START_PROFILE_ID,
    };
    const profileId = env.LOCAL_LLM_RUNTIME_MODE === 'on_demand' &&
      runtimeControl?.mode === 'on_demand' && runtimeIntent.runtimeStartProfileEnabled
      ? resolveRuntimeStartProfileIdForUseCase('business_hermes', runtimeIntent, provider)
      : undefined;

    // /healthz only proves gateway liveness; /v1/models probes its inference backend.
    // Parallel probes share the two-second budget, including the optional profile check.
    const [healthy] = await Promise.all([
      probeHttpOk(new URL('/v1/models', healthBaseUrl).toString(), fetch, 2000, {
        'X-LLM-Token': provider.sharedToken,
      }),
      profileId
        ? verifyBusinessRuntimeAfterProfileStart({
            fetchImpl: fetch,
            modelProfilesBaseUrl: healthBaseUrl,
            llmToken: provider.sharedToken,
            expectedProfileId: profileId,
            useCase: 'business_hermes',
            timeoutMs: 2000,
          })
        : Promise.resolve(),
    ]);
    return healthy;
  } catch {
    return false;
  }
}
