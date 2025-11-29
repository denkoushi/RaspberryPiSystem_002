import cron from 'node-cron';
import { SignageRenderer } from './signage.renderer.js';
import { SignageService } from './signage.service.js';
import { logger } from '../../lib/logger.js';

/**
 * サイネージレンダリングの定期実行を管理するクラス
 */
export class SignageRenderScheduler {
  private renderer: SignageRenderer;
  private cronJob: cron.ScheduledTask | null = null;
  private readonly defaultIntervalSeconds: number;

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
    
    // 既存のジョブがあれば停止
    if (this.cronJob) {
      this.stop();
    }

    // cron式を生成（例: 30秒ごと = "*/30 * * * * *"）
    const cronExpression = `*/${interval} * * * * *`;
    
    logger.info({ interval, cronExpression }, 'Starting signage render scheduler');

    this.cronJob = cron.schedule(cronExpression, async () => {
      try {
        logger.debug('Running scheduled signage render');
        await this.renderer.renderCurrentContent();
        logger.debug('Scheduled signage render completed');
      } catch (error) {
        logger.error({ err: error }, 'Failed to run scheduled signage render');
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    // 初回レンダリングを即座に実行
    this.renderer.renderCurrentContent()
      .then(() => {
        logger.info('Initial signage render completed');
      })
      .catch((error) => {
        logger.error({ err: error }, 'Failed to run initial signage render');
      });
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
  }

  /**
   * ジョブが実行中かどうかを確認
   */
  isRunning(): boolean {
    return this.cronJob !== null;
  }
}

