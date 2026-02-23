type AdaptiveRateSnapshot = {
  batchSize: number;
  requestDelayMs: number;
  successStreak: number;
  rateLimitStreak: number;
  updatedAt: string;
};

/**
 * Gmail向けの簡易AIMDコントローラ。
 * - 成功が続いたら小さく増やす（Additive Increase）
 * - 429時は半減する（Multiplicative Decrease）
 */
export class AdaptiveRateController {
  private static instance: AdaptiveRateController | null = null;

  private batchSize: number;
  private requestDelayMs: number;
  private successStreak = 0;
  private rateLimitStreak = 0;
  private updatedAt = new Date();

  private readonly minBatch = 1;
  private readonly maxBatch = 20;
  private readonly baseDelayMs = 2000;
  private readonly maxDelayMs = 10_000;

  private constructor() {
    const initialBatch = parseInt(process.env.GMAIL_MAX_MESSAGES_PER_BATCH || '10', 10);
    const initialDelay = parseInt(process.env.GMAIL_BATCH_REQUEST_DELAY_MS || '2000', 10);
    this.batchSize =
      Number.isFinite(initialBatch) && initialBatch > 0 ? Math.min(initialBatch, this.maxBatch) : 10;
    this.requestDelayMs =
      Number.isFinite(initialDelay) && initialDelay >= 0
        ? Math.min(Math.max(initialDelay, this.baseDelayMs), this.maxDelayMs)
        : this.baseDelayMs;
  }

  static getInstance(): AdaptiveRateController {
    if (!AdaptiveRateController.instance) {
      AdaptiveRateController.instance = new AdaptiveRateController();
    }
    return AdaptiveRateController.instance;
  }

  getBatchSize(): number {
    return this.batchSize;
  }

  getRequestDelayMs(): number {
    return this.requestDelayMs;
  }

  recordSuccess(): void {
    this.successStreak += 1;
    this.rateLimitStreak = 0;

    // 成功3回ごとに+1（緩やかな増加）
    if (this.successStreak >= 3) {
      this.batchSize = Math.min(this.maxBatch, this.batchSize + 1);
      this.successStreak = 0;
    }

    // 安定時は遅延をゆっくりベースへ戻す
    if (this.requestDelayMs > this.baseDelayMs) {
      this.requestDelayMs = Math.max(this.baseDelayMs, this.requestDelayMs - 250);
    }
    this.updatedAt = new Date();
  }

  recordRateLimit(): void {
    this.successStreak = 0;
    this.rateLimitStreak += 1;
    this.batchSize = Math.max(this.minBatch, Math.floor(this.batchSize / 2));
    this.requestDelayMs = Math.min(this.maxDelayMs, this.requestDelayMs + 1000);
    this.updatedAt = new Date();
  }

  getSnapshot(): AdaptiveRateSnapshot {
    return {
      batchSize: this.batchSize,
      requestDelayMs: this.requestDelayMs,
      successStreak: this.successStreak,
      rateLimitStreak: this.rateLimitStreak,
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * テスト用: シングルトンインスタンスをリセット
   */
  static resetInstance(): void {
    AdaptiveRateController.instance = null;
  }
}

