import { organizeTranscript, renderOrganized, type CompleteFn, type Organized } from './organizer.js';
import { LiveSegmenter } from './segmenter.js';

export type LiveMessage =
  | { type: 'partial'; id: number; text: string }
  | { type: 'final'; id: number; text: string }
  | { type: 'doc'; text: string; next: string }
  | { type: 'done' }
  | { type: 'error'; error: 'busy' | 'unavailable' };

export type LiveSessionOptions = {
  transcribe: (wav: Buffer, prompt: string) => Promise<string>;
  complete: CompleteFn;
  emit: (message: LiveMessage) => void;
  now?: () => number;
  terms?: string;
  organizeIntervalMs?: number;
  organizeTimeoutMs?: number;
  /** end() からの整理の上限(ms)。end() の時点から数え、超えたら整理を捨てて done を出す(画面は60秒で諦めるため)。書き起こしの取り切りは切らずに待つ。 */
  endOrganizeBudgetMs?: number;
  segmenter?: { silenceMs?: number; maxUtteranceMs?: number; minSpeechMs?: number; partialIntervalMs?: number };
};

export interface LiveSession {
  setTerms(terms: string): void;
  push(chunk: Buffer): void;
  end(): Promise<void>;
  close(): void;
}

/** One live meeting: segmenter for transcripts plus a throttled organizer. */
export class LiveMeetingSession implements LiveSession {
  private readonly segmenter: LiveSegmenter;
  private readonly now: () => number;
  private readonly interval: number;
  private readonly timeout: number;
  private readonly endBudget: number;
  private finals: string[] = [];
  private organized: Organized | null = null;
  private organizing: Promise<void> | null = null;
  private organizeAbort: AbortController | null = null;
  private runId = 0;
  private gaveUp = false;
  private dirty = false;
  private lastOrganizeAt: number;
  private closed = false;
  private terms: string;

  constructor(private readonly opts: LiveSessionOptions) {
    this.now = opts.now ?? Date.now;
    this.terms = opts.terms ?? '';
    this.interval = opts.organizeIntervalMs ?? 20000;
    this.timeout = opts.organizeTimeoutMs ?? 60000;
    this.endBudget = opts.endOrganizeBudgetMs ?? 45000;
    this.lastOrganizeAt = this.now();
    this.segmenter = new LiveSegmenter({
      ...opts.segmenter,
      terms: opts.terms,
      transcribe: opts.transcribe,
      onPartial: (id, text) => this.emit({ type: 'partial', id, text }),
      onFinal: (id, text) => {
        this.finals.push(text);
        this.dirty = true;
        this.emit({ type: 'final', id, text });
        if (this.now() - this.lastOrganizeAt >= this.interval) this.startOrganize();
      },
      onFatal: () => this.emit({ type: 'error', error: 'unavailable' })
    });
  }

  setTerms(terms: string): void { this.terms = terms; this.segmenter.setTerms(terms); }
  push(chunk: Buffer): void { if (!this.closed) this.segmenter.push(chunk); }
  close(): void { this.closed = true; }

  async end(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 予算を過ぎたら整理だけを諦める。書き起こしの取り切りは切らない(発言を落とさないため)
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(() => { this.gaveUp = true; this.abortCurrent(); resolve(); }, this.endBudget);
    });
    try {
      await this.segmenter.end();
      if (!this.gaveUp) {
        // 実行中の整理が古い文字しか見ていないなら捨て、全発言で今すぐやり直す(2回分待たない)
        if (this.organizing && this.dirty) this.abortCurrent();
        const work = (async () => {
          if (this.organizing) await this.organizing;
          if (this.dirty) {
            this.startOrganize();
            await this.organizing;
          }
        })();
        await Promise.race([work, budget]);
      }
    } finally {
      clearTimeout(timer);
      this.abortCurrent();
    }
    this.emit({ type: 'done' });
  }

  /** 実行中の整理を中止して無効にする。結果は捨て、状態も触らせない。 */
  private abortCurrent(): void {
    this.runId += 1;
    this.organizeAbort?.abort();
    this.organizeAbort = null;
    this.organizing = null;
  }

  private emit(message: LiveMessage): void {
    if (!this.closed) this.opts.emit(message);
  }

  private startOrganize(): void {
    if (this.organizing || !this.dirty || this.closed || this.gaveUp) return;
    this.dirty = false;
    this.lastOrganizeAt = this.now();
    const previous = this.organized;
    const run = ++this.runId;
    const abort = new AbortController();
    this.organizeAbort = abort;
    const promise: Promise<void> = (async () => {
      const result = await organizeTranscript(this.opts.complete, this.finals.join('\n'), previous, this.timeout, this.terms, abort.signal);
      if (run !== this.runId) return; // 中止・置き換え済み: 何も出さず状態も触らない
      if (!result) {
        this.dirty = true; // 失敗・読めない答えは次の発言(または終了時)に整理し直す
        this.lastOrganizeAt = Number.NEGATIVE_INFINITY; // 間隔を待たず次の発言で再試行できるようにする
        return;
      }
      if (result !== previous) {
        this.organized = result;
        this.emit({ type: 'doc', text: renderOrganized(result), next: result.next });
      }
    })().finally(() => {
      if (run === this.runId) { this.organizing = null; this.organizeAbort = null; }
    });
    this.organizing = promise;
  }
}
