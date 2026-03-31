import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';

const log = logger.child({ component: 'localLlmOnDemandRuntime' });
const ADMIN_CHAT_USE_CASE = 'admin_console_chat' as const;

function wantsAdminChatOnDemandWrapper(): boolean {
  return (
    env.LOCAL_LLM_RUNTIME_MODE === 'on_demand' && getInferenceRuntime().getAdminLocalLlmRuntimeConfig().configured
  );
}

export async function withAdminConsoleChatOnDemandRuntime<T>(fn: () => Promise<T>): Promise<T> {
  if (!wantsAdminChatOnDemandWrapper()) {
    return fn();
  }

  const runtime = getLocalLlmRuntimeController();
  if (runtime.getMode() !== 'on_demand') {
    throw new ApiError(
      503,
      'LocalLLM はオンデマンド運用ですが、起動制御の設定が不完全です',
      {
        hint: 'LOCAL_LLM_RUNTIME_CONTROL_START_URL / STOP_URL とトークン、LOCAL_LLM_RUNTIME_HEALTH_BASE_URL（または LOCAL_LLM_BASE_URL）を確認してください',
      },
      'LOCAL_LLM_RUNTIME_CONTROL_NOT_CONFIGURED'
    );
  }

  let runtimeHeld = false;
  try {
    await runtime.ensureReady(ADMIN_CHAT_USE_CASE);
    runtimeHeld = true;
  } catch (error) {
    throw new ApiError(
      503,
      'LocalLLM ランタイムの起動に失敗しました',
      {
        message: error instanceof Error ? error.message : String(error),
      },
      'LOCAL_LLM_RUNTIME_UNAVAILABLE'
    );
  }

  try {
    return await fn();
  } finally {
    if (runtimeHeld) {
      await runtime.release(ADMIN_CHAT_USE_CASE).catch((releaseErr) => {
        log.warn({ err: releaseErr }, '[LocalLlmOnDemandRuntime] release failed after admin chat');
      });
    }
  }
}
