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
    // #region agent log
    await fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a59f92' },
      body: JSON.stringify({
        sessionId: 'a59f92',
        runId: 'pre-fix',
        hypothesisId: 'H4',
        location: 'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
        message: 'aux runtime request start',
        data: {
          action: opts.action,
          targetUrl,
          timeoutMs: opts.timeoutMs,
          hasControlToken: Boolean(opts.controlToken?.trim()),
          errorCodePrefix: code,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const tok = opts.controlToken?.trim();
    if (tok) {
      headers['X-Runtime-Control-Token'] = tok;
    }

    const response = await deps.fetchImpl(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason: opts.reason ?? 'dgx_resource_aux' }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // #region agent log
      await fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a59f92' },
        body: JSON.stringify({
          sessionId: 'a59f92',
          runId: 'pre-fix',
          hypothesisId: 'H5',
          location: 'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
          message: 'aux runtime response not ok',
          data: {
            action: opts.action,
            targetUrl,
            httpStatus: response.status,
            bodyPreview: text.slice(0, 160),
            errorCodePrefix: code,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw new ApiError(
        502,
        '補助ランタイム制御が拒否または失敗しました',
        { httpStatus: response.status, body: text.slice(0, 500) },
        `${code}_CONTROL_FAILED`
      );
    }
    await response.text().catch(() => '');
    // #region agent log
    await fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a59f92' },
      body: JSON.stringify({
        sessionId: 'a59f92',
        runId: 'post-fix',
        hypothesisId: 'H6',
        location: 'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
        message: 'aux runtime response ok',
        data: {
          action: opts.action,
          targetUrl,
          errorCodePrefix: code,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } finally {
    cleanup();
  }
}
