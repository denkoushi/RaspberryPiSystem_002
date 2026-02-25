import cron from 'node-cron';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SignageRenderer } from './signage.renderer.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

/**
 * サイネージレンダリングの定期実行を管理するクラス
 */
export class SignageRenderScheduler {
  private renderer: SignageRenderer;
  private cronJob: cron.ScheduledTask | null = null;
  private worker: ChildProcess | null = null;
  private readonly defaultIntervalSeconds: number;
  private isRendering = false;
  private skipCount = 0;

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
        this.worker = fork(workerPath, [], {
          stdio: 'inherit',
          env: {
            ...process.env,
            // 子プロセス側は自分自身でレンダリング実行するため in_process 固定
            SIGNAGE_RENDER_RUNNER: 'in_process',
            SIGNAGE_RENDER_INTERVAL_SECONDS: String(interval),
          },
        });
        logger.info(
          { intervalSeconds: interval, pid: this.worker.pid },
          'Started signage render worker'
        );
        startedWorker = true;

        this.worker.once('exit', (code, signal) => {
          logger.warn(
            { code, signal },
            'Signage render worker exited'
          );
          // 表示・APIは継続させたいので、ここでは自動再起動しない（運用判断で再起動/デプロイ）
          this.worker = null;
        });
      } catch (error) {
        logger.error({ err: error }, 'Failed to start signage render worker; falling back to in-process renderer');
        // フォールバック: worker 起動に失敗した場合は従来通り in-process で継続
      }
    }

    if (startedWorker) {
      return;
    }

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
      this.worker = null;
      logger.info('Stopped signage render worker');
    }
  }

  /**
   * ジョブが実行中かどうかを確認
   */
  isRunning(): boolean {
    // env だけに依存すると「worker起動失敗→in-processフォールバック」時に不整合が出るため実体で判定する
    return (this.worker !== null && !this.worker.killed) || this.cronJob !== null;
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
      logger.info({ trigger, durationMs, skipCount: this.skipCount }, 'Scheduled signage render completed');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.error({ err: error, trigger, durationMs, skipCount: this.skipCount }, 'Failed to run scheduled signage render');
    } finally {
      this.isRendering = false;
    }
  }
}

