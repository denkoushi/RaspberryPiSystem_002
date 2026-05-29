import type { InferenceProviderDefinition } from './inference-provider.types.js';
import type { BusinessProfileIntentSource } from './business-profile-intent-store.js';
import { getBusinessProfileIntentStore } from './business-profile-intent-store.js';
import type { LocalLlmRuntimeUseCase } from '../runtime/local-llm-runtime-control.port.js';

export type BusinessProfileIntentEnv = {
  businessRuntimeStartProfileId?: string;
  photoLabelRuntimeStartProfileId?: string;
  documentSummaryRuntimeStartProfileId?: string;
  adminRuntimeStartProfileId?: string;
};

export type ResolvedBusinessProfileIntent = {
  modelProfileId: string;
  source: 'provider' | BusinessProfileIntentSource | 'legacy_use_case_env';
};

const BUSINESS_RUNTIME_USE_CASES: ReadonlySet<LocalLlmRuntimeUseCase> = new Set([
  'photo_label',
  'document_summary',
  'admin_console_chat',
  'stackchan_chat',
]);

export function isBusinessRuntimeUseCase(useCase: LocalLlmRuntimeUseCase): boolean {
  return BUSINESS_RUNTIME_USE_CASES.has(useCase);
}

function legacyProfileForUseCase(
  useCase: LocalLlmRuntimeUseCase,
  env: BusinessProfileIntentEnv
): string | undefined {
  if (useCase === 'photo_label') {
    return env.photoLabelRuntimeStartProfileId?.trim() || undefined;
  }
  if (useCase === 'document_summary') {
    return env.documentSummaryRuntimeStartProfileId?.trim() || undefined;
  }
  if (useCase === 'admin_console_chat' || useCase === 'stackchan_chat') {
    return env.adminRuntimeStartProfileId?.trim() || undefined;
  }
  return undefined;
}

/**
 * 業務機能全体で共有する modelProfileId を解決する。
 * 優先順: provider.runtimeStartProfileId → INFERENCE_BUSINESS_*（運用固定）→ store（orchestration のみ）→ 用途別 env
 *
 * DGX active は store に載せない（overview 閲覧だけで /start 意図が変わらないようにする）。
 */
export function resolveBusinessRuntimeStartProfile(
  env: BusinessProfileIntentEnv,
  provider?: InferenceProviderDefinition
): ResolvedBusinessProfileIntent | undefined {
  const fromProvider = provider?.runtimeStartProfileId?.trim();
  if (fromProvider) {
    return { modelProfileId: fromProvider, source: 'provider' };
  }

  const businessEnv = env.businessRuntimeStartProfileId?.trim();
  if (businessEnv) {
    return { modelProfileId: businessEnv, source: 'env' };
  }

  const storeRecord = getBusinessProfileIntentStore().get();
  if (storeRecord?.source === 'orchestration') {
    const storeId = storeRecord.modelProfileId.trim();
    if (storeId) {
      return { modelProfileId: storeId, source: 'orchestration' };
    }
  }

  return undefined;
}

/**
 * 用途別 on-demand /start 用。業務 use case は共通 business profile を優先する。
 */
export function resolveRuntimeStartProfileIdForBusinessUseCase(
  useCase: LocalLlmRuntimeUseCase,
  env: BusinessProfileIntentEnv,
  provider?: InferenceProviderDefinition
): string | undefined {
  if (!isBusinessRuntimeUseCase(useCase)) {
    return legacyProfileForUseCase(useCase, env);
  }

  const business = resolveBusinessRuntimeStartProfile(env, provider);
  if (business) {
    return business.modelProfileId;
  }

  return legacyProfileForUseCase(useCase, env);
}

/**
 * 共通 business profile と用途別 env が食い違う場合は起動前に失敗させる。
 */
export function assertBusinessProfileIntentEnvConsistency(env: BusinessProfileIntentEnv): void {
  const business = env.businessRuntimeStartProfileId?.trim();
  if (!business) {
    return;
  }

  const legacyIds = [
    env.photoLabelRuntimeStartProfileId?.trim(),
    env.documentSummaryRuntimeStartProfileId?.trim(),
    env.adminRuntimeStartProfileId?.trim(),
  ].filter((id): id is string => Boolean(id));

  const conflicting = legacyIds.filter((id) => id !== business);
  if (conflicting.length > 0) {
    throw new Error(
      `INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID (${business}) conflicts with per-use-case runtime profile env (${conflicting.join(', ')}). Align or clear per-use-case IDs.`
    );
  }
}
