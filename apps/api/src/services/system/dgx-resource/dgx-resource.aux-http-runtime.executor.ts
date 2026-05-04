import { ApiError } from '../../../lib/errors.js';
import { createTimeoutSignal } from './dgx-resource.probes.js';

export type AuxHttpRuntimeExecutorDeps = {
  fetchImpl: typeof fetch;
};

function emitAuxDebugLog(
  runId: string,
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
): void {
  // #region agent log
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'504530'},body:JSON.stringify({sessionId:'504530',runId,hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

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
    emitAuxDebugLog(
      'pre-fix',
      'H10',
      'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
      'aux runtime request start',
      {
        action: opts.action,
        targetUrl,
        timeoutMs: opts.timeoutMs,
        hasControlToken: Boolean(opts.controlToken?.trim()),
        errorCodePrefix: code,
      }
    );
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
          emitAuxDebugLog(
            'post-fix',
            'H11',
            'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
            'aux runtime response ok',
            {
              action: opts.action,
              targetUrl,
              attempt,
              maxAttempts,
              errorCodePrefix: code,
            }
          );
          return;
        }

        lastStatus = response.status;
        lastBody = text.slice(0, 500);
        emitAuxDebugLog(
          'pre-fix',
          'H10',
          'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
          'aux runtime response not ok',
          {
            action: opts.action,
            targetUrl,
            attempt,
            maxAttempts,
            httpStatus: response.status,
            bodyPreview: text.slice(0, 160),
            errorCodePrefix: code,
          }
        );
      } catch (error: unknown) {
        const message =
          typeof error === 'object' && error != null && 'message' in error ? String((error as { message: unknown }).message) : String(error);
        lastNetworkError = message.slice(0, 300);
        emitAuxDebugLog(
          'pre-fix',
          'H10',
          'dgx-resource.aux-http-runtime.executor.ts:executeAuxHttpRuntimeStartStop',
          'aux runtime network error',
          {
            action: opts.action,
            targetUrl,
            attempt,
            maxAttempts,
            networkError: lastNetworkError,
            errorCodePrefix: code,
          }
        );
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
