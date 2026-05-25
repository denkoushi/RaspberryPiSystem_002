import { ApiError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';
import {
  enqueueMainLocalLlmRuntimeControl,
  MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES,
} from '../../inference/runtime/local-llm-runtime-command-queue.js';

import { createTimeoutSignal } from './dgx-resource.probes.js';

export type GatewayRuntimeExecutorDeps = {
  fetchImpl: typeof fetch;
};

function resolveGatewayRuntimeControlUrl(action: 'start' | 'stop' | 'stop_force', startUrl: string, stopUrl: string): string {
  if (action === 'start') return startUrl;
  if (action === 'stop') return stopUrl;
  return stopUrl.endsWith('/stop') ? `${stopUrl}-force` : `${stopUrl}/force`;
}

export { resolveGatewayRuntimeControlUrl };

/**
 * system-prod gateway への /start | /stop | /stop-force（既存 Pi5→DGX 契約の拡張）。
 */
export async function executeGatewayRuntimeStartStop(
  deps: GatewayRuntimeExecutorDeps,
  action: 'start' | 'stop' | 'stop_force',
  reason?: string
): Promise<void> {
  const startUrl = env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim();
  const stopUrl = env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim();
  const runtimeConfigured = Boolean(startUrl && stopUrl);
  if (!runtimeConfigured || env.LOCAL_LLM_RUNTIME_MODE !== 'on_demand') {
    throw new ApiError(
      400,
      'LocalLLM が on_demand かつ 起動/停止 URL が設定されているときのみ操作できます',
      { mode: env.LOCAL_LLM_RUNTIME_MODE, runtimeConfigured },
      'DGX_RUNTIME_CONTROL_NOT_CONFIGURED'
    );
  }

  const targetUrl = resolveGatewayRuntimeControlUrl(action, startUrl!, stopUrl!);
  const timeoutMs =
    action === 'start'
      ? env.LOCAL_LLM_RUNTIME_START_REQUEST_TIMEOUT_MS
      : env.LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS;

  const token =
    env.LOCAL_LLM_RUNTIME_CONTROL_TOKEN?.trim() || env.LOCAL_LLM_SHARED_TOKEN?.trim() || '';
  if (!token) {
    throw new ApiError(503, 'ランタイム制御トークンが未設定です', undefined, 'DGX_RUNTIME_TOKEN_MISSING');
  }

  await enqueueMainLocalLlmRuntimeControl(
    `dgx_gateway_runtime_${action}`,
    async () => {
      const { signal, cleanup } = createTimeoutSignal(timeoutMs);
      try {
        const response = await deps.fetchImpl(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Runtime-Control-Token': token,
          },
          body: JSON.stringify({ reason: reason ?? 'dgx_resource_ui' }),
          signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new ApiError(
            502,
            'DGX 側のランタイム制御が拒否または失敗しました',
            { httpStatus: response.status, body: text.slice(0, 500) },
            'DGX_RUNTIME_CONTROL_FAILED'
          );
        }
        await response.text().catch(() => '');
      } finally {
        cleanup();
      }
    },
    MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.gatewayControl
  );
}
