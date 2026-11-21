import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveMeetingSession, type LiveMessage } from '../live-session.js';

function pcm(ms: number, amplitude: number): Buffer {
  const samples = (16000 * ms) / 1000;
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / 16000)), i * 2);
  return buf;
}

describe('LiveMeetingSession', () => {
  it('organizes again at the end when an earlier organize failed', async () => {
    const messages: LiveMessage[] = [];
    let calls = 0;
    const session = new LiveMeetingSession({
      transcribe: async () => '砥石を交換します',
      complete: async () => {
        calls += 1;
        if (calls === 1) throw new Error('llm down');
        return '{"topics":["砥石交換"],"decisions":[],"open":[],"actions":[],"next":"手順を確認"}';
      },
      emit: (m) => messages.push(m),
      organizeIntervalMs: 0
    });
    session.push(pcm(300, 0));
    session.push(pcm(1000, 4000));
    session.push(pcm(1000, 0));
    await session.end();
    expect(calls).toBe(2);
    expect(messages.filter((m) => m.type === 'final')).toHaveLength(1);
    expect(messages).toContainEqual({ type: 'doc', text: '【論点】\n・砥石交換', next: '手順を確認' });
    expect(messages.at(-1)).toEqual({ type: 'done' });
  });
});

describe('LiveMeetingSession organize timing', () => {
  const DOC = (t: string) => `{"topics":["${t}"],"decisions":[],"open":[],"actions":[],"next":""}`;

  function setup(opts: { latency: number; never?: boolean; failFirst?: boolean; interval?: number; budget?: number }) {
    const messages: LiveMessage[] = [];
    const inputs: string[] = [];
    let n = 0;
    let t = 0;
    const session = new LiveMeetingSession({
      transcribe: async () => `発言${(t += 1)}`,
      complete: (msgs, signal) => new Promise<string>((resolve, reject) => {
        n += 1;
        const call = n;
        inputs.push(msgs[1]!.content as string);
        signal.addEventListener('abort', () => reject(new Error('aborted')));
        if (opts.never) return;
        if (opts.failFirst && call === 1) { setTimeout(() => reject(new Error('down')), opts.latency); return; }
        const lines = (msgs[1]!.content as string).split('\n').filter((l) => l.startsWith('発言')).length;
        setTimeout(() => resolve(DOC(`n${lines}`)), opts.latency);
      }),
      emit: (m) => messages.push(m),
      organizeIntervalMs: opts.interval ?? 20000,
      endOrganizeBudgetMs: opts.budget
    });
    const say = async () => {
      session.push(pcm(300, 0)); session.push(pcm(1000, 4000)); session.push(pcm(1000, 0));
      await vi.advanceTimersByTimeAsync(0);
    };
    return { session, messages, inputs, say, calls: () => n };
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('A: aborts an in-flight organize with newer text and finishes in about one latency', async () => {
    const { session, messages, inputs, say } = setup({ latency: 25000, interval: 0 });
    await say(); // final 1 -> organize starts
    await vi.advanceTimersByTimeAsync(1000);
    await say(); // final 2 arrives while organizing (dirty)
    const started = Date.now();
    const ending = session.end();
    await vi.advanceTimersByTimeAsync(24999);
    expect(messages.some((m) => m.type === 'done')).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await ending;
    expect(Date.now() - started).toBeLessThan(26000);
    const docs = messages.filter((m) => m.type === 'doc');
    const finals = messages.filter((m) => m.type === 'final').length;
    expect(finals).toBe(2);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('発言2');
    expect(docs).toEqual([{ type: 'doc', text: `【論点】\n・n${inputs[1]!.split('\n').filter((l) => l.startsWith('発言')).length}`, next: '' }]);
    expect(messages.filter((m) => m.type === 'done')).toHaveLength(1);
  });

  it('B: gives up at the budget when the LLM never answers, emitting done once', async () => {
    const { session, messages, say } = setup({ latency: 0, never: true, interval: 0, budget: 45000 });
    await say();
    const ending = session.end();
    await vi.advanceTimersByTimeAsync(44999);
    expect(messages.some((m) => m.type === 'done')).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await ending;
    await vi.advanceTimersByTimeAsync(120000);
    expect(messages.filter((m) => m.type === 'done')).toHaveLength(1);
    expect(messages.some((m) => m.type === 'doc')).toBe(false);
  });

  it('D: waits for slow transcription past the budget and keeps the speech, skipping only the organize', async () => {
    const messages: LiveMessage[] = [];
    let organizeCalls = 0;
    const session = new LiveMeetingSession({
      transcribe: () => new Promise<string>((resolve) => { setTimeout(() => resolve('砥石を交換します'), 50000); }),
      complete: () => { organizeCalls += 1; return new Promise<string>(() => {}); },
      emit: (m) => messages.push(m),
      organizeIntervalMs: 0,
      endOrganizeBudgetMs: 45000,
      segmenter: { partialIntervalMs: 1_000_000 }
    });
    session.push(pcm(300, 0)); session.push(pcm(1000, 4000)); session.push(pcm(1000, 0));
    const ending = session.end();
    await vi.advanceTimersByTimeAsync(45001);
    expect(messages.some((m) => m.type === 'done')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await ending;
    const types = messages.map((m) => m.type);
    expect(types.filter((t) => t === 'final')).toHaveLength(1);
    expect(types.at(-1)).toBe('done');
    expect(types.filter((t) => t === 'done')).toHaveLength(1);
    expect(organizeCalls).toBe(0);
  });

  it('C: after a failed organize the next final retries immediately', async () => {
    const { session, messages, say, calls } = setup({ latency: 3000, failFirst: true, interval: 20000 });
    await vi.advanceTimersByTimeAsync(20000);
    await say(); // organize #1 starts (fails after 3 s)
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    await say(); // next final: retry now, not 20 s later
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(messages.filter((m) => m.type === 'doc')).toHaveLength(1);
    session.close();
  });
});
