import { env } from '../../config/env.js';

import { OpenAiCompatibleTextAdapter } from './adapters/openai-compatible-text.adapter.js';
import { RoutedVisionCompletionAdapter } from './adapters/routed-vision-completion.adapter.js';
import {
  resolveAdminInferenceModel,
  resolveAdminInferenceProvider,
} from './config/admin-inference-provider.js';
import { synthesizeProvidersFromLegacyLlm, tryParseInferenceProvidersJson } from './config/parse-inference-providers.js';
import type { InferenceProviderDefinition } from './config/inference-provider.types.js';
import { InferenceRouter, type InferenceRouterConfig } from './routing/inference-router.js';
import type { TextCompletionPort } from './ports/text-completion.port.js';
import type { VisionCompletionPort } from './ports/vision-completion.port.js';

export type AdminLocalLlmRuntimeConfigShape = {
  configured: boolean;
  baseUrl?: string;
  sharedToken?: string;
  model?: string;
  timeoutMs: number;
};

export type InferenceRuntime = {
  router: InferenceRouter;
  providers: InferenceProviderDefinition[];
  getAdminProvider: () => InferenceProviderDefinition | undefined;
  /** 管理用 LocalLLM プロキシ（既定プロバイダ default または先頭） */
  getAdminLocalLlmRuntimeConfig: () => AdminLocalLlmRuntimeConfigShape;
  createVisionCompletionPort: () => VisionCompletionPort;
  createTextCompletionPort: () => TextCompletionPort;
  isPhotoLabelInferenceConfigured: () => boolean;
  isDocumentSummaryInferenceConfigured: () => boolean;
};

function buildProviders(): InferenceProviderDefinition[] {
  const fromJson = tryParseInferenceProvidersJson(env.INFERENCE_PROVIDERS_JSON);
  if (fromJson && fromJson.length > 0) {
    return fromJson;
  }
  return synthesizeProvidersFromLegacyLlm({
    baseUrl: env.LOCAL_LLM_BASE_URL,
    sharedToken: env.LOCAL_LLM_SHARED_TOKEN,
    model: env.LOCAL_LLM_MODEL,
    timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
    runtimeMode: env.LOCAL_LLM_RUNTIME_MODE,
    runtimeControlStartUrl: env.LOCAL_LLM_RUNTIME_CONTROL_START_URL,
    runtimeControlStopUrl: env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL,
    runtimeControlToken:
      env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN?.trim() || env.LOCAL_LLM_SHARED_TOKEN?.trim() || undefined,
    runtimeHealthBaseUrl: env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL,
  });
}

function buildRouterConfig(providers: InferenceProviderDefinition[]): InferenceRouterConfig {
  return {
    providers,
    routes: {
      photo_label: {
        providerId: env.INFERENCE_PHOTO_LABEL_PROVIDER_ID,
        modelOverride: env.INFERENCE_PHOTO_LABEL_MODEL,
      },
      document_summary: {
        providerId: env.INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID,
        modelOverride: env.INFERENCE_DOCUMENT_SUMMARY_MODEL,
      },
    },
  };
}

export function buildInferenceRuntime(fetchImpl: typeof fetch = fetch): InferenceRuntime {
  const providers = buildProviders();
  const router = new InferenceRouter(buildRouterConfig(providers));
  const getAdminProvider = (): InferenceProviderDefinition | undefined =>
    resolveAdminInferenceProvider(providers, env.INFERENCE_ADMIN_PROVIDER_ID);

  const getAdminLocalLlmRuntimeConfig = (): AdminLocalLlmRuntimeConfigShape => {
    const adminProvider = getAdminProvider();
    const adminModel = resolveAdminInferenceModel(adminProvider, env.INFERENCE_ADMIN_MODEL);
    const configured = Boolean(adminProvider?.baseUrl && adminProvider?.sharedToken && adminModel);
    return {
      configured,
      baseUrl: adminProvider?.baseUrl,
      sharedToken: adminProvider?.sharedToken,
      model: adminModel,
      timeoutMs: adminProvider?.timeoutMs ?? env.LOCAL_LLM_TIMEOUT_MS,
    };
  };

  return {
    router,
    providers,
    getAdminProvider,
    getAdminLocalLlmRuntimeConfig,
    createVisionCompletionPort: () =>
      new RoutedVisionCompletionAdapter({
        router,
        fetchImpl,
        useCase: 'photo_label',
        getMaxTokens: () => env.INFERENCE_PHOTO_LABEL_VISION_MAX_TOKENS,
        getTemperature: () => env.INFERENCE_PHOTO_LABEL_VISION_TEMPERATURE,
      }),
    createTextCompletionPort: () =>
      new OpenAiCompatibleTextAdapter({
        router,
        fetchImpl,
      }),
    isPhotoLabelInferenceConfigured: () => providers.length > 0 && router.isResolvable('photo_label'),
    isDocumentSummaryInferenceConfigured: () => providers.length > 0 && router.isResolvable('document_summary'),
  };
}

let singleton: InferenceRuntime | null = null;

export function getInferenceRuntime(): InferenceRuntime {
  if (!singleton) {
    singleton = buildInferenceRuntime();
  }
  return singleton;
}

/** テスト用 */
export function resetInferenceRuntimeForTests(): void {
  singleton = null;
}
