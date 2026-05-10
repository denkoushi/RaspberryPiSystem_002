import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { getInferenceRuntime } from '../inference-runtime.js';

import type { LocalLlmRuntimeControllerPort, LocalLlmRuntimeUseCase } from './local-llm-runtime-control.port.js';
import {
  type LocalLlmWarmWindowConfig,
  shouldSuppressLocalLlmRuntimeStop,
} from './local-llm-runtime-schedule.policy.js';
import { NoopLocalLlmRuntimeController } from './noop-local-llm-runtime.controller.js';
import { resetMainLocalLlmRuntimeControlQueueForTests } from './local-llm-runtime-command-queue.js';
import { ProviderLocalLlmRuntimeController } from './provider-local-llm-runtime.controller.js';

const log = logger.child({ component: 'localLlmRuntimeControl' });

let singleton: LocalLlmRuntimeControllerPort | null = null;

function resolveAdminConsoleChatModel(): string {
  const runtimeConfig = getInferenceRuntime().getAdminLocalLlmRuntimeConfig();
  return runtimeConfig.model?.trim() || env.LOCAL_LLM_MODEL?.trim() || '';
}

function buildWarmWindowConfig(): LocalLlmWarmWindowConfig {
  return {
    enabled: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED,
    timeZone: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_TIMEZONE,
    startHourInclusive: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR,
    endHourExclusive: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR,
  };
}

function buildUseCaseStopSuppress(): (useCase: LocalLlmRuntimeUseCase) => boolean {
  const warmConfig = buildWarmWindowConfig();
  return (useCase: LocalLlmRuntimeUseCase) => {
    try {
      return shouldSuppressLocalLlmRuntimeStop({
        useCase,
        now: new Date(),
        warmWindow: warmConfig,
      });
    } catch (err) {
      log.warn(
        { err, useCase, action: 'stop_suppress_eval_failed' },
        '[LocalLlmRuntimeControl] stop suppress evaluation failed; allowing stop'
      );
      return false;
    }
  };
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
    shouldSuppressStop: buildUseCaseStopSuppress(),
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
  resetMainLocalLlmRuntimeControlQueueForTests();
}
