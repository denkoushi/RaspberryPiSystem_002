import { ApiError } from '../../../lib/errors.js';
import { createTimeoutSignal } from './dgx-resource.probes.js';

export type AuxHttpRuntimeExecutorDeps = {
  fetchImpl: typeof fetch;
};

/**
 * 補助ランタイム（私用 ComfyUI・experiment-lab 等）への POST。
 * gateway と同様 `X-Runtime-Control-Token` を使用（DGX 側側車輪で統一しやすい）。
 */
export async function executeAuxHttpRuntimeStartStop(
  deps: AuxHttpRuntimeExecutorDeps,
  opts: {
    action: 'start' | 'stop';
    startUrl: string;
    stopUrl: string;
    timeoutMs: number;
    controlToken?: string;
    reason?: string;
    /** ApiError に載せる識別子 */
    errorCodePrefix?: string;
  }
): Promise<void> {
  const su = opts.startUrl.trim();
  const tu = opts.stopUrl.trim();
  if (!su || !tu) {
    throw new ApiError(
      400,
      '補助ランタイムの起動/停止 URL が未設定です',
      undefined,
      'DGX_AUX_RUNTIME_CONTROL_NOT_CONFIGURED'
    );
  }

  const targetUrl = opts.action === 'start' ? su : tu;
  const code = opts.errorCodePrefix ?? 'DGX_AUX_RUNTIME';

  const { signal, cleanup } = createTimeoutSignal(opts.timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const tok = opts.controlToken?.trim();
    if (tok) {
      headers['X-Runtime-Control-Token'] = tok;
    }

    const maxAttempts = opts.action === 'stop' ? 2 : 1;
    let lastStatus: number | null = null;
    let lastBody = '';
    let lastNetworkError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await deps.fetchImpl(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ reason: opts.reason ?? 'dgx_resource_aux' }),
          signal,
        });
        const text = await response.text().catch(() => '');
        if (response.ok) {
          return;
        }

        lastStatus = response.status;
        lastBody = text.slice(0, 500);
      } catch (error: unknown) {
        const message =
          typeof error === 'object' && error != null && 'message' in error ? String((error as { message: unknown }).message) : String(error);
        lastNetworkError = message.slice(0, 300);
      }
    }

    throw new ApiError(
      502,
      '補助ランタイム制御が拒否または失敗しました',
      { httpStatus: lastStatus, body: lastBody, networkError: lastNetworkError, attempts: maxAttempts },
      `${code}_CONTROL_FAILED`
    );
  } finally {
    cleanup();
  }
}
