import cron from 'node-cron';

export type CronBatchJobOptions<T> = {
  /** start() のたびに読む。false なら予約しない。 */
  enabled: () => boolean;
  cron: () => string;
  run: (signal: AbortSignal) => Promise<T>;
  onDone: (result: T) => void;
  /** stop() で止めたときも呼ばれる。止めた結果かどうかは signal.aborted で見分ける。 */
  onError: (error: unknown, signal: AbortSignal) => void;
  timeoutMs?: number;
};

/** 夜の一括処理を cron で動かす。前の回が終わるまで次を始めず、stop() は動いている回を止めて終わるまで待つ。 */
export class CronBatchJob<T> {
  private task: cron.ScheduledTask | null = null;
  private abort: AbortController | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly options: CronBatchJobOptions<T>) {}

  start() {
    if (this.task || !this.options.enabled()) return;
    this.task = cron.schedule(this.options.cron(), () => this.tick(), { timezone: 'Asia/Tokyo' });
  }

  async stop() {
    this.task?.stop();
    this.task = null;
    this.abort?.abort();
    await this.active;
  }

  private tick() {
    if (this.active) return;
    this.abort = new AbortController();
    const { timeoutMs } = this.options;
    const signal = timeoutMs ? AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutMs)]) : this.abort.signal;
    this.active = this.options.run(signal)
      .then(result => this.options.onDone(result))
      .catch(error => this.options.onError(error, signal))
      .finally(() => { this.active = null; this.abort = null; });
  }
}
