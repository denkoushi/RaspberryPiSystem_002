import type { InferenceProviderDefinition } from './inference-provider.types.js';
import type { InferenceRouter } from '../routing/inference-router.js';
import type { InferenceUseCase } from '../types/inference-usecase.js';
import type { LocalLlmRuntimeUseCase } from '../runtime/local-llm-runtime-control.port.js';
import {
  assertBusinessProfileIntentEnvConsistency,
  resolveRuntimeStartProfileIdForBusinessUseCase,
  type BusinessProfileIntentEnv,
} from './business-profile-intent.js';

export type InferenceRuntimeIntentEnv = BusinessProfileIntentEnv & {
  runtimeStartProfileEnabled: boolean;
};

const ROUTED_USE_CASES: readonly InferenceUseCase[] = ['photo_label', 'document_summary'];

const RUNTIME_INTENT_USE_CASES: readonly LocalLlmRuntimeUseCase[] = [
  'photo_label',
  'document_summary',
  'admin_console_chat',
  'stackchan_chat',
];

function isRoutedInferenceUseCase(useCase: LocalLlmRuntimeUseCase): useCase is InferenceUseCase {
  return useCase === 'photo_label' || useCase === 'document_summary';
}

/**
 * 用途ごとの DGX modelProfileId 意図（shadow / opt-in start 用）。
 * 業務 use case は共通 business profile を優先する。
 */
export function resolveRuntimeStartProfileIdForUseCase(
  useCase: LocalLlmRuntimeUseCase,
  env: InferenceRuntimeIntentEnv,
  provider: InferenceProviderDefinition
): string | undefined {
  return resolveRuntimeStartProfileIdForBusinessUseCase(useCase, env, provider);
}

export function shouldSendRuntimeStartProfileId(
  env: InferenceRuntimeIntentEnv,
  profileId: string | undefined
): boolean {
  return env.runtimeStartProfileEnabled && Boolean(profileId?.trim());
}

/**
 * on_demand controller のキャッシュキー。
 * opt-in かつ profile 解決がある用途は provider + profile で分離（refCount /start の共有誤りを防ぐ）。
 */
export function buildOnDemandControllerCacheKey(
  provider: InferenceProviderDefinition,
  useCase: LocalLlmRuntimeUseCase,
  env: InferenceRuntimeIntentEnv
): string {
  if (!env.runtimeStartProfileEnabled) {
    return provider.id;
  }
  const profileId = resolveRuntimeStartProfileIdForUseCase(useCase, env, provider);
  if (!profileId) {
    return provider.id;
  }
  return `${provider.id}::${profileId}`;
}

function providerUsesOnDemandRuntime(
  provider: InferenceProviderDefinition,
  resolveRuntimeControl?: (
    provider: InferenceProviderDefinition
  ) => { mode: 'always_on' | 'on_demand' } | undefined
): boolean {
  const runtimeControl = resolveRuntimeControl?.(provider) ?? provider.runtimeControl;
  return runtimeControl?.mode === 'on_demand';
}

/**
 * 同一 provider を共有する用途で異なる modelProfileId が解決されると、
 * refCount 共有により後続用途の /start が抑止される。opt-in 有効時は起動時に検出する。
 */
export function assertConsistentRuntimeProfileIntentOnSharedProviders(
  router: InferenceRouter,
  resolveAdminProvider: () => InferenceProviderDefinition | undefined,
  env: InferenceRuntimeIntentEnv,
  resolveRuntimeControl?: (
    provider: InferenceProviderDefinition
  ) => { mode: 'always_on' | 'on_demand' } | undefined
): void {
  assertBusinessProfileIntentEnvConsistency(env);

  if (!env.runtimeStartProfileEnabled) {
    return;
  }

  const profilesByProvider = new Map<string, Set<string>>();

  for (const useCase of RUNTIME_INTENT_USE_CASES) {
    const provider =
      useCase === 'admin_console_chat' || useCase === 'stackchan_chat'
        ? resolveAdminProvider()
        : isRoutedInferenceUseCase(useCase)
          ? (() => {
            try {
              return router.resolve(useCase).provider;
            } catch {
              return undefined;
            }
          })()
          : undefined;

    if (!provider || !providerUsesOnDemandRuntime(provider, resolveRuntimeControl)) {
      continue;
    }

    const profileId = resolveRuntimeStartProfileIdForUseCase(useCase, env, provider) ?? '';
    const bucket = profilesByProvider.get(provider.id) ?? new Set<string>();
    bucket.add(profileId);
    profilesByProvider.set(provider.id, bucket);
  }

  for (const [providerId, profileIds] of profilesByProvider) {
    if (profileIds.size <= 1) {
      continue;
    }
    throw new Error(
      `INFERENCE_RUNTIME_START_PROFILE_ENABLED: provider "${providerId}" resolves conflicting runtimeStartProfileId values across use cases (${[...profileIds].join(', ')}). Use INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID for a single shared profile or disable opt-in.`
    );
  }
}

export { ROUTED_USE_CASES, RUNTIME_INTENT_USE_CASES };
