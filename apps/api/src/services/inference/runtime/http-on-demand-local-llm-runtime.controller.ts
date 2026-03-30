import { performance } from 'node:perf_hooks';

import { logger } from '../../../lib/logger.js';

import type { LocalLlmRuntimeControllerPort, LocalLlmRuntimeUseCase } from './local-llm-runtime-control.port.js';

const log = logger.child({ component: 'localLlmRuntimeControl' });

export type HttpOnDemandLocalLlmRuntimeControllerDeps = {
  fetchImpl: typeof fetch;
  startUrl: string;
  stopUrl: string;
  controlToken: string;
  /** llama-server の health 確認先（通常は LOCAL_LLM_BASE_URL と同じ） */
  healthCheckBaseUrl: string;
  llmToken: string;
  readyTimeoutMs: number;
  startRequestTimeoutMs: number;
  stopRequestTimeoutMs: number;
  healthPollIntervalMs: number;
};

/**
 * Pi5 から HTTP で Ubuntu 側の起動・停止エンドポイントを叩くオンデマンド制御。
 * 参照カウントで複数用途・連続ジョブが重なっても安全に扱う。
 */
export class HttpOnDemandLocalLlmRuntimeController implements LocalLlmRuntimeControllerPort {
  private refCount = 0;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly deps: HttpOnDemandLocalLlmRuntimeControllerDeps) {}

  getMode(): 'on_demand' {
    return 'on_demand';
  }

  async ensureReady(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    this.refCount += 1;
    if (this.refCount === 1) {
      this.readyPromise = this.startAndWaitUntilHealthy(useCase);
    }
    const p = this.readyPromise;
    if (!p) {
      this.refCount = Math.max(0, this.refCount - 1);
      throw new Error('LocalLlmRuntimeControl: internal state error (missing ready promise)');
    }
    try {
      await p;
    } catch (err) {
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) {
        this.readyPromise = null;
      }
      throw err;
    }
  }

  async release(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount > 0) {
      return;
    }
    this.readyPromise = null;
    await this.stopQuietly(useCase);
  }

  private async startAndWaitUntilHealthy(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    const started = performance.now();
    await this.postStart(useCase, started);
    await this.pollHealthUntilReady(useCase, started);
    log.info(
      {
        useCase,
        action: 'runtime_ready',
        latencyMs: Math.round(performance.now() - started),
      },
      '[LocalLlmRuntimeControl] runtime ready'
    );
  }

  private async postStart(useCase: LocalLlmRuntimeUseCase, batchStarted: number): Promise<void> {
    const signal = AbortSignal.timeout(this.deps.startRequestTimeoutMs);
    const res = await this.deps.fetchImpl(this.deps.startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Runtime-Control-Token': this.deps.controlToken,
      },
      body: JSON.stringify({ reason: useCase }),
      signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      log.warn(
        {
          useCase,
          action: 'runtime_start_http',
          httpStatus: res.status,
          latencyMs: Math.round(performance.now() - batchStarted),
          bodyLen: t.length,
        },
        '[LocalLlmRuntimeControl] start endpoint non-OK'
      );
      throw new Error(`LocalLlmRuntimeControl: start failed HTTP ${res.status}`);
    }
  }

  private async pollHealthUntilReady(useCase: LocalLlmRuntimeUseCase, batchStarted: number): Promise<void> {
    const deadline = batchStarted + this.deps.readyTimeoutMs;
    const healthUrl = new URL('/healthz', this.deps.healthCheckBaseUrl);
    const headers: Record<string, string> = {};
    if (this.deps.llmToken) {
      headers['X-LLM-Token'] = this.deps.llmToken;
    }

    while (performance.now() < deadline) {
      try {
        const perReqMs = Math.min(10_000, Math.max(1000, this.deps.readyTimeoutMs));
        const signal = AbortSignal.timeout(perReqMs);
        const r = await this.deps.fetchImpl(healthUrl, { method: 'GET', headers, signal });
        if (r.ok) {
          return;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, this.deps.healthPollIntervalMs));
    }
    log.error(
      {
        useCase,
        action: 'runtime_ready_timeout',
        latencyMs: Math.round(performance.now() - batchStarted),
      },
      '[LocalLlmRuntimeControl] health wait timeout'
    );
    throw new Error('LocalLlmRuntimeControl: llama-server did not become healthy in time');
  }

  private async stopQuietly(useCase: LocalLlmRuntimeUseCase): Promise<void> {
    const started = performance.now();
    try {
      const signal = AbortSignal.timeout(this.deps.stopRequestTimeoutMs);
      const res = await this.deps.fetchImpl(this.deps.stopUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-Control-Token': this.deps.controlToken,
        },
        body: JSON.stringify({ reason: useCase }),
        signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        log.warn(
          {
            useCase,
            action: 'runtime_stop_http',
            httpStatus: res.status,
            latencyMs: Math.round(performance.now() - started),
            bodyLen: t.length,
          },
          '[LocalLlmRuntimeControl] stop endpoint non-OK'
        );
      } else {
        log.info(
          {
            useCase,
            action: 'runtime_stopped',
            latencyMs: Math.round(performance.now() - started),
          },
          '[LocalLlmRuntimeControl] runtime stop requested'
        );
      }
    } catch (err) {
      log.warn(
        {
          err,
          useCase,
          action: 'runtime_stop_error',
          latencyMs: Math.round(performance.now() - started),
        },
        '[LocalLlmRuntimeControl] stop request failed'
      );
    }
  }
}
