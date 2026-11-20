import { isHallucination } from './hallucination.js';
import { FRAME_MS, FRAME_SAMPLES, frameRms, pcmToWav } from './pcm.js';

export type SegmenterOptions = {
  transcribe: (wav: Buffer, prompt: string) => Promise<string>;
  onPartial: (id: number, text: string) => void;
  onFinal: (id: number, text: string) => void;
  onFatal?: () => void;
  terms?: string;
  silenceMs?: number;
  maxUtteranceMs?: number;
  minSpeechMs?: number;
  partialIntervalMs?: number;
};

type Frame = { pcm: Buffer; rms: number; speech: boolean };
type Utterance = { id: number; frames: Frame[]; lastPartialAtMs: number };
type FinalJob = { id: number; pcm: Buffer };

const PROMPT_PART_CHARS = 200;
const MIN_THRESHOLD = 250;
const PRE_ROLL_FRAMES = 5;
const MAX_FAILURES = 3;

export function composePrompt(terms: string, history: string): string {
  return [terms.slice(0, PROMPT_PART_CHARS), history.trim().slice(-PROMPT_PART_CHARS)].filter(Boolean).join(' ');
}

/** Energy-VAD segmenter: turns a PCM stream into partial/final transcripts. */
export class LiveSegmenter {
  private readonly silenceMs: number;
  private readonly maxUtteranceMs: number;
  private readonly minSpeechMs: number;
  private readonly partialIntervalMs: number;
  private terms: string;
  private carry: Buffer = Buffer.alloc(0);
  private noiseFloor = 0;
  private preRoll: Frame[] = [];
  private utt: Utterance | null = null;
  private audioMs = 0;
  private nextId = 1;
  private history = '';
  private queue: FinalJob[] = [];
  private inflight = false;
  private failures = 0;
  private fatal = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly opts: SegmenterOptions) {
    this.silenceMs = opts.silenceMs ?? 700;
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15000;
    this.minSpeechMs = opts.minSpeechMs ?? 300;
    this.partialIntervalMs = opts.partialIntervalMs ?? 1000;
    this.terms = opts.terms ?? '';
  }

  setTerms(terms: string): void { this.terms = terms; }

  push(chunk: Buffer): void {
    this.carry = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const frameBytes = FRAME_SAMPLES * 2;
    let offset = 0;
    while (this.carry.length - offset >= frameBytes) {
      const pcm = Buffer.from(this.carry.subarray(offset, offset + frameBytes));
      offset += frameBytes;
      this.processFrame(pcm);
    }
    this.carry = Buffer.from(this.carry.subarray(offset));
  }

  /** Finalizes the open utterance and resolves once every transcription is done. */
  async end(): Promise<void> {
    if (this.utt) this.finalizeAll();
    await this.whenIdle();
  }

  private threshold(): number { return Math.max(MIN_THRESHOLD, this.noiseFloor * 3); }

  private processFrame(pcm: Buffer): void {
    this.audioMs += FRAME_MS;
    const rms = frameRms(pcm);
    const speech = rms > this.threshold();
    const frame: Frame = { pcm, rms, speech };
    if (!speech) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
    if (!this.utt) {
      if (speech) {
        this.utt = { id: this.nextId++, frames: [...this.preRoll, frame], lastPartialAtMs: this.audioMs };
        this.preRoll = [];
      } else {
        this.preRoll.push(frame);
        if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
      }
      return;
    }
    const utt = this.utt;
    utt.frames.push(frame);
    if (this.trailingSilenceMs(utt.frames) >= this.silenceMs) { this.finalizeAll(); return; }
    if (utt.frames.length * FRAME_MS >= this.maxUtteranceMs) { this.cutAtQuietest(); return; }
    this.maybePartial();
  }

  private trailingSilenceMs(frames: Frame[]): number {
    let n = 0;
    for (let i = frames.length - 1; i >= 0 && !frames[i].speech; i--) n++;
    return n * FRAME_MS;
  }

  private speechMs(frames: Frame[]): number { return frames.filter((f) => f.speech).length * FRAME_MS; }

  private finalizeAll(): void {
    const utt = this.utt;
    this.utt = null;
    this.preRoll = [];
    if (utt) this.enqueueFinal(utt.id, utt.frames);
  }

  /** Splits a long utterance at the quietest frame of its recent past. */
  private cutAtQuietest(): void {
    const utt = this.utt;
    if (!utt) return;
    const total = utt.frames.length;
    const from = Math.max(Math.floor(total / 3), total - 100);
    let best = total - 1;
    let bestRms = Infinity;
    for (let i = from; i < total; i++) {
      if (utt.frames[i].rms <= bestRms) { bestRms = utt.frames[i].rms; best = i; }
    }
    const head = utt.frames.slice(0, best + 1);
    const tail = utt.frames.slice(best + 1);
    this.enqueueFinal(utt.id, head);
    this.utt = tail.length ? { id: this.nextId++, frames: tail, lastPartialAtMs: this.audioMs } : null;
  }

  private enqueueFinal(id: number, frames: Frame[]): void {
    if (this.speechMs(frames) < this.minSpeechMs) { this.notifyIdle(); return; }
    this.queue.push({ id, pcm: Buffer.concat(frames.map((f) => f.pcm)) });
    this.pump();
  }

  private maybePartial(): void {
    const utt = this.utt;
    if (!utt || this.inflight || this.queue.length > 0) return;
    if (this.audioMs - utt.lastPartialAtMs < this.partialIntervalMs) return;
    if (this.speechMs(utt.frames) < this.minSpeechMs) return;
    utt.lastPartialAtMs = this.audioMs;
    const id = utt.id;
    const pcm = Buffer.concat(utt.frames.map((f) => f.pcm));
    this.inflight = true;
    void this.run(pcm).then((text) => {
      if (text && this.utt?.id === id && !isHallucination(text)) this.opts.onPartial(id, text);
    }).finally(() => { this.inflight = false; this.pump(); });
  }

  private pump(): void {
    if (this.inflight) return;
    const job = this.queue.shift();
    if (!job) { this.notifyIdle(); return; }
    this.inflight = true;
    void this.run(job.pcm).then((text) => {
      if (text && !isHallucination(text)) {
        this.history = `${this.history} ${text}`.slice(-PROMPT_PART_CHARS * 2);
        this.opts.onFinal(job.id, text);
      }
    }).finally(() => { this.inflight = false; this.pump(); });
  }

  private async run(pcm: Buffer): Promise<string | null> {
    try {
      const text = (await this.opts.transcribe(pcmToWav(pcm), composePrompt(this.terms, this.history))).trim();
      this.failures = 0;
      return text;
    } catch {
      this.failures++;
      if (this.failures >= MAX_FAILURES && !this.fatal) { this.fatal = true; this.opts.onFatal?.(); }
      return null;
    }
  }

  private whenIdle(): Promise<void> {
    if (!this.inflight && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => { this.idleWaiters.push(resolve); });
  }

  private notifyIdle(): void {
    if (this.inflight || this.queue.length > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }
}
