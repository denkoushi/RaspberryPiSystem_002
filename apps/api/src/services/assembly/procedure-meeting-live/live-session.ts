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
  private finals: string[] = [];
  private organized: Organized | null = null;
  private organizing: Promise<void> | null = null;
  private dirty = false;
  private lastOrganizeAt: number;
  private closed = false;

  constructor(private readonly opts: LiveSessionOptions) {
    this.now = opts.now ?? Date.now;
    this.interval = opts.organizeIntervalMs ?? 20000;
    this.timeout = opts.organizeTimeoutMs ?? 60000;
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

  setTerms(terms: string): void { this.segmenter.setTerms(terms); }
  push(chunk: Buffer): void { if (!this.closed) this.segmenter.push(chunk); }
  close(): void { this.closed = true; }

  async end(): Promise<void> {
    await this.segmenter.end();
    if (this.organizing) await this.organizing;
    if (this.dirty) {
      this.startOrganize();
      await this.organizing;
    }
    this.emit({ type: 'done' });
  }

  private emit(message: LiveMessage): void {
    if (!this.closed) this.opts.emit(message);
  }

  private startOrganize(): void {
    if (this.organizing || !this.dirty || this.closed) return;
    this.dirty = false;
    this.lastOrganizeAt = this.now();
    const previous = this.organized;
    this.organizing = (async () => {
      const result = await organizeTranscript(this.opts.complete, this.finals.join('\n'), previous, this.timeout);
      if (!result) {
        this.dirty = true; // 失敗・読めない答えは次の機会(または終了時)に整理し直す
        return;
      }
      if (result !== previous) {
        this.organized = result;
        this.emit({ type: 'doc', text: renderOrganized(result), next: result.next });
      }
    })().finally(() => { this.organizing = null; });
  }
}
