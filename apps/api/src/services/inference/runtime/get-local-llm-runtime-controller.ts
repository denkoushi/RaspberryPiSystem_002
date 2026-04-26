import { env } from '../../../config/env.js';
import { getInferenceRuntime } from '../inference-runtime.js';

import type { LocalLlmRuntimeControllerPort } from './local-llm-runtime-control.port.js';
import { NoopLocalLlmRuntimeController } from './noop-local-llm-runtime.controller.js';
import { ProviderLocalLlmRuntimeController } from './provider-local-llm-runtime.controller.js';

let singleton: LocalLlmRuntimeControllerPort | null = null;

function resolveAdminConsoleChatModel(): string {
  const runtimeConfig = getInferenceRuntime().getAdminLocalLlmRuntimeConfig();
  return runtimeConfig.model?.trim() || env.LOCAL_LLM_MODEL?.trim() || '';
}

function buildController(fetchImpl: typeof fetch = fetch): LocalLlmRuntimeControllerPort {
  if (env.LOCAL_LLM_RUNTIME_MODE !== 'on_demand') {
    return new NoopLocalLlmRuntimeController();
  }

  const inferenceRuntime = getInferenceRuntime();
  return new ProviderLocalLlmRuntimeController({
    fetchImpl,
    globalMode: env.LOCAL_LLM_RUNTIME_MODE,
    router: inferenceRuntime.router,
    providers: inferenceRuntime.providers,
    resolveAdminProvider: inferenceRuntime.getAdminProvider,
    resolveAdminModel: resolveAdminConsoleChatModel,
    legacyAdminRuntimeControl:
      env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim() || env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim()
        ? {
            mode: 'on_demand',
            startUrl: env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim(),
            stopUrl: env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim(),
            controlToken:
              env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN?.trim() || env.LOCAL_LLM_SHARED_TOKEN?.trim() || undefined,
            healthBaseUrl: env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL?.trim() || env.LOCAL_LLM_BASE_URL?.trim(),
          }
        : undefined,
    readyTimeoutMs: env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS,
    startRequestTimeoutMs: env.LOCAL_LLM_RUNTIME_START_REQUEST_TIMEOUT_MS,
    stopRequestTimeoutMs: env.LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS,
    healthPollIntervalMs: env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS,
  });
}

export function getLocalLlmRuntimeController(fetchImpl?: typeof fetch): LocalLlmRuntimeControllerPort {
  if (!singleton) {
    singleton = buildController(fetchImpl ?? fetch);
  }
  return singleton;
}

/** テスト用 */
export function resetLocalLlmRuntimeControllerForTests(): void {
  singleton = null;
}
