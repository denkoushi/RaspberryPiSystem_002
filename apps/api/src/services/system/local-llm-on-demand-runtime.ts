import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';

const log = logger.child({ component: 'localLlmOnDemandRuntime' });
const ADMIN_CHAT_USE_CASE = 'admin_console_chat' as const;
const STACKCHAN_CHAT_USE_CASE = 'stackchan_chat' as const;
const AGENT_CONTAINER_TASK_USE_CASE = 'agent_container_task' as const;

/** admin / StackChan は同一 upstream（LOCAL_LLM_* / admin provider）を参照するため on_demand 条件も共通 */
function wantsAdminLikeLocalLlmOnDemandWrapper(): boolean {
  return (
    env.LOCAL_LLM_RUNTIME_MODE === 'on_demand' && getInferenceRuntime().getAdminLocalLlmRuntimeConfig().configured
  );
}

function wantsAdminChatOnDemandWrapper(): boolean {
  return wantsAdminLikeLocalLlmOnDemandWrapper();
}

function wantsStackChanChatOnDemandWrapper(): boolean {
  return wantsAdminLikeLocalLlmOnDemandWrapper();
}

function wantsAgentContainerTaskOnDemandWrapper(): boolean {
  return (
    env.LOCAL_LLM_RUNTIME_MODE === 'on_demand' &&
    Boolean(
      env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL?.trim() &&
        env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_STOP_URL?.trim()
    )
  );
}

function isRuntimeControlConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('on_demand config incomplete');
}

export async function withAdminConsoleChatOnDemandRuntime<T>(fn: () => Promise<T>): Promise<T> {
  if (!wantsAdminChatOnDemandWrapper()) {
    return fn();
  }

  const runtime = getLocalLlmRuntimeController();
  let runtimeHeld = false;
  try {
    await runtime.ensureReady(ADMIN_CHAT_USE_CASE);
    runtimeHeld = true;
  } catch (error) {
    if (isRuntimeControlConfigError(error)) {
      throw new ApiError(
        503,
        'LocalLLM はオンデマンド運用ですが、起動制御の設定が不完全です',
        {
          hint: 'provider.runtimeControl または LOCAL_LLM_RUNTIME_CONTROL_START_URL / STOP_URL / TOKEN / HEALTH_BASE_URL を確認してください',
          message: error instanceof Error ? error.message : String(error),
        },
        'LOCAL_LLM_RUNTIME_CONTROL_NOT_CONFIGURED'
      );
    }
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

export async function withStackChanChatOnDemandRuntime<T>(fn: () => Promise<T>): Promise<T> {
  if (!wantsStackChanChatOnDemandWrapper()) {
    return fn();
  }

  const runtime = getLocalLlmRuntimeController();
  let runtimeHeld = false;
  try {
    await runtime.ensureReady(STACKCHAN_CHAT_USE_CASE);
    runtimeHeld = true;
  } catch (error) {
    if (isRuntimeControlConfigError(error)) {
      throw new ApiError(
        503,
        'StackChan 向け LocalLLM はオンデマンド運用ですが、起動制御の設定が不完全です',
        {
          hint: 'provider.runtimeControl または LOCAL_LLM_RUNTIME_CONTROL_START_URL / STOP_URL / TOKEN / HEALTH_BASE_URL を確認してください（admin チャットと同一経路）',
          message: error instanceof Error ? error.message : String(error),
        },
        'LOCAL_LLM_RUNTIME_CONTROL_NOT_CONFIGURED'
      );
    }
    throw new ApiError(
      503,
      'StackChan 向け LocalLLM ランタイムの起動に失敗しました',
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
      await runtime.release(STACKCHAN_CHAT_USE_CASE).catch((releaseErr) => {
        log.warn({ err: releaseErr }, '[LocalLlmOnDemandRuntime] release failed after stackchan chat');
      });
    }
  }
}

/** Agent コンテナ用 ensure/release（DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_* が揃うときのみラップ）。 */
export async function withAgentContainerTaskOnDemandRuntime<T>(fn: () => Promise<T>): Promise<T> {
  if (!wantsAgentContainerTaskOnDemandWrapper()) {
    return fn();
  }

  const runtime = getLocalLlmRuntimeController();
  let runtimeHeld = false;
  try {
    await runtime.ensureReady(AGENT_CONTAINER_TASK_USE_CASE);
    runtimeHeld = true;
  } catch (error) {
    if (isRuntimeControlConfigError(error)) {
      throw new ApiError(
        503,
        'Agent コンテナはオンデマンド運用ですが、起動制御またはヘルス URL の設定が不完全です',
        {
          hint: 'DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_* と DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL（または start URL から導出できる /health）を確認してください',
          message: error instanceof Error ? error.message : String(error),
        },
        'LOCAL_LLM_AGENT_CONTAINER_CONTROL_NOT_CONFIGURED'
      );
    }
    throw new ApiError(
      503,
      'Agent コンテナの起動に失敗しました',
      {
        message: error instanceof Error ? error.message : String(error),
      },
      'LOCAL_LLM_AGENT_CONTAINER_UNAVAILABLE'
    );
  }

  try {
    return await fn();
  } finally {
    if (runtimeHeld) {
      await runtime.release(AGENT_CONTAINER_TASK_USE_CASE).catch((releaseErr) => {
        log.warn({ err: releaseErr }, '[LocalLlmOnDemandRuntime] release failed after agent container task');
      });
    }
  }
}
