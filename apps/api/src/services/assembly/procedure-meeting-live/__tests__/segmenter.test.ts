import { describe, expect, it } from 'vitest';

import { isHallucination } from '../hallucination.js';
import { pcmToWav } from '../pcm.js';
import { composePrompt, LiveSegmenter } from '../segmenter.js';

const frame = (amp: number) => {
  const b = Buffer.alloc(960);
  for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2);
  return b;
};
const feed = (s: LiveSegmenter, amp: number, ms: number) => { for (let i = 0; i < ms / 30; i++) s.push(frame(amp)); };
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(transcribe: (wav: Buffer, prompt: string) => Promise<string>, extra = {}) {
  const partials: Array<[number, string]> = [];
  const finals: Array<[number, string]> = [];
  const seg = new LiveSegmenter({
    transcribe, onPartial: (i, t) => partials.push([i, t]), onFinal: (i, t) => finals.push([i, t]), ...extra
  });
  return { seg, partials, finals };
}

describe('LiveSegmenter', () => {
  it('finalizes after 700 ms of silence', async () => {
    const { seg, finals } = setup(async () => 'こんにちは', { partialIntervalMs: 100000 });
    feed(seg, 0, 300);
    feed(seg, 3000, 900);
    feed(seg, 0, 600);
    await flush();
    expect(finals).toHaveLength(0);
    feed(seg, 0, 150);
    await seg.end();
    expect(finals).toEqual([[1, 'こんにちは']]);
  });

  it('drops utterances with under 300 ms of speech', async () => {
    const calls: string[] = [];
    const { seg, finals } = setup(async () => { calls.push('x'); return 'あ'; });
    feed(seg, 3000, 150);
    feed(seg, 0, 900);
    await seg.end();
    expect(calls).toHaveLength(0);
    expect(finals).toHaveLength(0);
  });

  it('cuts a long utterance at the quietest recent frame', async () => {
    const lens: number[] = [];
    const { seg, finals } = setup(async (wav) => { lens.push(wav.length); return `t${lens.length}`; }, { partialIntervalMs: 100000 });
    feed(seg, 3000, 12000);
    feed(seg, 1500, 90); // dip, still speech-like
    feed(seg, 3000, 4000);
    await seg.end();
    expect(finals.length).toBeGreaterThanOrEqual(2);
    expect(lens[0]).toBeLessThanOrEqual(44 + 15000 / 30 * 960);
  });

  it('runs one transcription at a time and throttles partials', async () => {
    let active = 0; let maxActive = 0; let calls = 0;
    let release: () => void = () => {};
    const { seg, partials } = setup(async () => {
      calls++; active++; maxActive = Math.max(maxActive, active);
      if (calls <= 2) await new Promise<void>((r) => { release = r; });
      active--; return '途中';
    });
    feed(seg, 3000, 1500); // first partial starts (1s) and stays in flight
    feed(seg, 3000, 3000); // no second one while in flight
    expect(calls).toBe(1);
    release();
    await flush();
    expect(partials).toEqual([[1, '途中']]);
    feed(seg, 3000, 1100);
    expect(calls).toBe(2);
    release();
    await seg.end();
    expect(maxActive).toBe(1);
  });

  it('filters hallucinations and composes prompts from terms and history', async () => {
    const prompts: string[] = [];
    const answers = ['ご視聴ありがとうございました', '社内の報告です'];
    const { seg, finals } = setup(async (_w, p) => { prompts.push(p); return answers.shift() ?? 'つぎ'; }, { terms: 'M6 ねじ', partialIntervalMs: 100000 });
    feed(seg, 3000, 600); feed(seg, 0, 800);
    feed(seg, 3000, 600); feed(seg, 0, 800);
    feed(seg, 3000, 600);
    await seg.end();
    expect(finals.map((f) => f[1])).toEqual(['社内の報告です', 'つぎ']);
    expect(prompts[0]).toBe('M6 ねじ');
    expect(prompts[2]).toBe('M6 ねじ 社内の報告です');
  });

  it('composePrompt trims each part to 200 chars', () => {
    const p = composePrompt('a'.repeat(300), 'b'.repeat(300));
    expect(p).toBe(`${'a'.repeat(200)} ${'b'.repeat(200)}`);
  });

  it('reports fatal after repeated failures', async () => {
    let fatal = 0;
    const { seg } = setup(async () => { throw new Error('x'); }, { onFatal: () => { fatal++; }, partialIntervalMs: 100000 });
    for (let i = 0; i < 4; i++) { feed(seg, 3000, 600); feed(seg, 0, 800); }
    await seg.end();
    expect(fatal).toBe(1);
  });
});

describe('helpers', () => {
  it('detects hallucinations', () => {
    for (const t of ['', '。。', 'ご視聴ありがとうございました。', 'ありがとうございました', 'ああああああああ']) expect(isHallucination(t)).toBe(true);
    expect(isHallucination('ねじを締めます')).toBe(false);
  });
  it('wraps PCM in a 16 kHz mono WAV', () => {
    const wav = pcmToWav(Buffer.alloc(100));
    expect(wav.length).toBe(144);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
  });
});
