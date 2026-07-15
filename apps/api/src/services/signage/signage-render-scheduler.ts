import cron from 'node-cron';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SignageRenderer } from './signage.renderer.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { SchedulerStepStateAmbiguousError } from '../../bootstrap/scheduler-errors.js';

export const SIGNAGE_RENDER_WORKER_READY = 'signage-render-worker-ready';

/**
 * サイネージレンダリングの定期実行を管理するクラス
 */
export class SignageRenderScheduler {
  private renderer: SignageRenderer;
  private cronJob: cron.ScheduledTask | null = null;
  private worker: ChildProcess | null = null;
  private workerExited: Promise<void> | null = null;
  private workerReady: Promise<void> | null = null;
  private deployOperationTail: Promise<void> = Promise.resolve();
  private readonly defaultIntervalSeconds: number;
  private isRendering = false;
  private skipCount = 0;
  private lastRenderDurationMs: number | null = null;
  private lastRenderTrigger: 'initial' | 'scheduled' | null = null;
  private lastRenderCompletedAtMs: number | null = null;

  constructor(renderer: SignageRenderer, intervalSeconds: number = 30) {
    this.renderer = renderer;
    this.defaultIntervalSeconds = intervalSeconds;
  }

  /**
   * 定期レンダリングジョブを開始
   * 
   * @param intervalSeconds レンダリング間隔（秒）。デフォルトは30秒
   */
  start(intervalSeconds?: number): void {
    const interval = intervalSeconds ?? this.defaultIntervalSeconds;
    
    // 既存のジョブ/worker があれば停止
    this.stop();

    // 本番はデフォルトで worker（別プロセス）に逃がし、APIのイベントループ詰まりを避ける
    let startedWorker = false;
    if (env.SIGNAGE_RENDER_RUNNER === 'worker') {
      try {
        const workerPath = fileURLToPath(new URL('./signage-render-worker.js', import.meta.url));
        const worker = fork(workerPath, [], {
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
          env: {
            ...process.env,
            // 子プロセス側は自分自身でレンダリング実行するため in_process 固定
            SIGNAGE_RENDER_RUNNER: 'in_process',
            SIGNAGE_RENDER_INTERVAL_SECONDS: String(interval),
          },
        });
        this.worker = worker;
        let resolveWorkerExited: (() => void) | undefined;
        let workerTerminalSettled = false;
        const workerExited = new Promise<void>((resolve) => {
          resolveWorkerExited = resolve;
        });
        const settleWorkerTerminal = () => {
          if (workerTerminalSettled) return;
          workerTerminalSettled = true;
          if (this.worker === worker) {
            this.worker = null;
            this.workerExited = null;
            this.workerReady = null;
          }
          resolveWorkerExited?.();
        };
        worker.on('error', (error) => {
          logger.error({ err: error, pid: worker.pid }, 'Signage render worker process error');
          // Node does not guarantee an `exit` event when spawning fails. In
          // that case `pid` remains undefined, so settle immediately instead
          // of leaving deploy pause blocked on a promise that can never end.
          if (worker.pid === undefined) settleWorkerTerminal();
        });
        worker.once('exit', (code, signal) => {
          logger.warn(
            { code, signal },
            'Signage render worker exited'
          );
          settleWorkerTerminal();
        });
        // `close` follows either normal exit or a spawn error. Keep it as the
        // final fallback while making terminal settlement idempotent.
        worker.once('close', settleWorkerTerminal);
        this.workerExited = workerExited;
        const workerReady = new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            worker.off('message', onMessage);
            worker.off('error', onError);
            worker.off('exit', onExitBeforeReady);
          };
          const onMessage = (message: unknown) => {
            if (
              typeof message !== 'object'
              || message === null
              || (message as { type?: unknown }).type !== SIGNAGE_RENDER_WORKER_READY
            ) {
              return;
            }
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const onExitBeforeReady = (code: number | null, signal: NodeJS.Signals | null) => {
            cleanup();
            reject(new Error(
              `Signage render worker exited before readiness (code=${String(code)}, signal=${String(signal)})`
            ));
          };
          worker.on('message', onMessage);
          worker.once('error', onError);
          worker.once('exit', onExitBeforeReady);
        });
        // start() remains a public compatibility method. Keep a rejection
        // observer attached even when a caller does not use the deploy-aware
        // resumeAfterDeploy() readiness contract.
        void workerReady.catch(() => undefined);
        this.workerReady = workerReady;
        logger.info(
          { intervalSeconds: interval, pid: worker.pid },
          'Started signage render worker'
        );
        startedWorker = true;
      } catch (error) {
        logger.error({ err: error }, 'Failed to start signage render worker; falling back to in-process renderer');
        // フォールバック: worker 起動に失敗した場合は従来通り in-process で継続
      }
    }

    if (startedWorker) {
      return;
    }

    this.workerReady = null;

    // cron式を生成（例: 30秒ごと = "*/30 * * * * *"）
    const cronExpression = `*/${interval} * * * * *`;
    
    logger.info({ interval, cronExpression }, 'Starting signage render scheduler');

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.runScheduledRender('scheduled');
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    // 初回レンダリングを即座に実行
    void this.runScheduledRender('initial');
  }

  /**
   * 定期レンダリングジョブを停止
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('Stopped signage render scheduler');
    }
    if (this.worker) {
      try {
        this.worker.kill('SIGTERM');
      } catch {
        // ignore
      }
      logger.info('Stopped signage render worker');
    }
  }

  /** Stop new work and wait until the current renderer process/job is quiescent. */
  pauseForDeploy(timeoutMs = 120_000): Promise<void> {
    return this.runDeployOperation(() => this.pauseForDeployUnlocked(timeoutMs));
  }

  private async pauseForDeployUnlocked(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const workerExited = this.workerExited;
    this.stop();
    while (this.isRendering && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.isRendering) throw new Error('Timed out waiting for in-process signage rendering to stop');
    if (workerExited) {
      await this.waitForWorkerExit(workerExited, deadline);
    }
  }

  resumeAfterDeploy(timeoutMs = 10_000): Promise<void> {
    return this.runDeployOperation(() => this.resumeAfterDeployUnlocked(timeoutMs));
  }

  private async resumeAfterDeployUnlocked(timeoutMs: number): Promise<void> {
    if (this.isRunning()) {
      const existingWorkerReady = this.workerReady;
      if (existingWorkerReady) {
        try {
          await this.waitForWorkerReadiness(existingWorkerReady, timeoutMs);
        } catch (error) {
          await this.stopAfterReadinessFailure(error, timeoutMs);
        }
      }
      if (!this.isRunning()) {
        throw new Error('Signage render scheduler stopped while confirming readiness');
      }
      return;
    }

    // A synchronous stop marks ChildProcess.killed before the terminal event
    // arrives. Never fork a replacement until that exact worker is gone.
    const stoppingWorkerExited = this.workerExited;
    if (stoppingWorkerExited) {
      await this.waitForWorkerExit(stoppingWorkerExited, Date.now() + timeoutMs);
    }

    this.start();
    const workerReady = this.workerReady;
    if (workerReady) {
      try {
        await this.waitForWorkerReadiness(workerReady, timeoutMs);
      } catch (error) {
        await this.stopAfterReadinessFailure(error, timeoutMs);
      }
    }
    if (!this.isRunning()) {
      throw new Error('Signage render scheduler did not become active');
    }
  }

  private async stopAfterReadinessFailure(readinessError: unknown, timeoutMs: number): Promise<never> {
    try {
      await this.pauseForDeployUnlocked(timeoutMs);
    } catch (cleanupError) {
      throw new SchedulerStepStateAmbiguousError(
        'signage-render',
        [readinessError, cleanupError]
      );
    }
    throw readinessError;
  }

  private async waitForWorkerExit(workerExited: Promise<void>, deadline: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for signage worker to stop')),
        Math.max(1, deadline - Date.now())
      );
      void workerExited.then(() => {
        clearTimeout(timer);
        resolve();
      }, (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async waitForWorkerReadiness(workerReady: Promise<void>, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for signage worker readiness')),
        timeoutMs
      );
      void workerReady.then(() => {
        clearTimeout(timer);
        resolve();
      }, (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private runDeployOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.deployOperationTail.then(operation, operation);
    this.deployOperationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /**
   * ジョブが実行中かどうかを確認
   */
  isRunning(): boolean {
    // env だけに依存すると「worker起動失敗→in-processフォールバック」時に不整合が出るため実体で判定する
    return (this.worker !== null && !this.worker.killed) || this.cronJob !== null;
  }

  getTelemetrySnapshot(): {
    runner: 'in_process' | 'worker';
    isRunning: boolean;
    isRendering: boolean;
    workerPid: number | null;
    skipCount: number;
    lastRenderDurationMs: number | null;
    lastRenderTrigger: 'initial' | 'scheduled' | null;
    lastRenderCompletedAt: string | null;
  } {
    return {
      runner: env.SIGNAGE_RENDER_RUNNER,
      isRunning: this.isRunning(),
      isRendering: this.isRendering,
      workerPid: this.worker?.pid ?? null,
      skipCount: this.skipCount,
      lastRenderDurationMs: this.lastRenderDurationMs,
      lastRenderTrigger: this.lastRenderTrigger,
      lastRenderCompletedAt:
        this.lastRenderCompletedAtMs === null ? null : new Date(this.lastRenderCompletedAtMs).toISOString(),
    };
  }

  private async runScheduledRender(trigger: 'initial' | 'scheduled'): Promise<void> {
    if (this.isRendering) {
      this.skipCount += 1;
      logger.warn(
        { trigger, skipCount: this.skipCount, reason: 'previous render is still running' },
        'Skipped signage render to avoid overlapping execution'
      );
      return;
    }

    this.isRendering = true;
    const startedAt = Date.now();
    try {
      logger.info({ trigger }, 'Running scheduled signage render');
      await this.renderer.renderCurrentContent();
      const durationMs = Date.now() - startedAt;
      this.lastRenderDurationMs = durationMs;
      this.lastRenderTrigger = trigger;
      this.lastRenderCompletedAtMs = Date.now();
      logger.info({ trigger, durationMs, skipCount: this.skipCount }, 'Scheduled signage render completed');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.lastRenderDurationMs = durationMs;
      this.lastRenderTrigger = trigger;
      logger.error({ err: error, trigger, durationMs, skipCount: this.skipCount }, 'Failed to run scheduled signage render');
    } finally {
      this.isRendering = false;
    }
  }
}
