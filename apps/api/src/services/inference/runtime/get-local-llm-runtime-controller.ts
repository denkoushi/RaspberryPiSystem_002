import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import { getInferenceRuntime } from '../inference-runtime.js';

import { HttpOnDemandLocalLlmRuntimeController } from './http-on-demand-local-llm-runtime.controller.js';
import type { LocalLlmRuntimeControllerPort } from './local-llm-runtime-control.port.js';
import { NoopLocalLlmRuntimeController } from './noop-local-llm-runtime.controller.js';

const log = logger.child({ component: 'localLlmRuntimeControl' });

let singleton: LocalLlmRuntimeControllerPort | null = null;

function resolveAdminConsoleChatModel(): string {
  const runtimeConfig = getInferenceRuntime().getAdminLocalLlmRuntimeConfig();
  return runtimeConfig.model?.trim() || env.LOCAL_LLM_MODEL?.trim() || '';
}

function buildController(fetchImpl: typeof fetch = fetch): LocalLlmRuntimeControllerPort {
  if (env.LOCAL_LLM_RUNTIME_MODE !== 'on_demand') {
    return new NoopLocalLlmRuntimeController();
  }

  const startUrl = env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim();
  const stopUrl = env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim();
  const controlToken =
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN?.trim() || env.LOCAL_LLM_SHARED_TOKEN?.trim() || '';
  const healthBase =
    env.LOCAL_LLM_RUNTIME_HEALTH_BASE_URL?.trim() || env.LOCAL_LLM_BASE_URL?.trim() || '';

  if (!startUrl || !stopUrl || !controlToken || !healthBase) {
    log.warn(
      {
        hasStartUrl: Boolean(startUrl),
        hasStopUrl: Boolean(stopUrl),
        hasControlToken: Boolean(controlToken),
        hasHealthBase: Boolean(healthBase),
      },
      '[LocalLlmRuntimeControl] on_demand selected but control URLs/token/health base incomplete; falling back to no-op (inference may fail if server is stopped)'
    );
    return new NoopLocalLlmRuntimeController();
  }

  const llmToken = env.LOCAL_LLM_SHARED_TOKEN?.trim() || '';

  return new HttpOnDemandLocalLlmRuntimeController({
    fetchImpl,
    startUrl,
    stopUrl,
    controlToken,
    healthCheckBaseUrl: healthBase,
    llmToken,
    readyProbeModels: {
      photo_label: env.INFERENCE_PHOTO_LABEL_MODEL?.trim() || env.LOCAL_LLM_MODEL?.trim() || '',
      document_summary: env.INFERENCE_DOCUMENT_SUMMARY_MODEL?.trim() || env.LOCAL_LLM_MODEL?.trim() || '',
      admin_console_chat: resolveAdminConsoleChatModel(),
    },
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
