import { describe, expect, it } from 'vitest';

import { LiveMeetingSession, type LiveMessage } from '../live-session.js';
import { buildOrganizeMessages, organizeTranscript, parseOrganized, renderOrganized } from '../organizer.js';

const json = '{"topics":["寸法"],"decisions":["M6にする"],"open":[],"actions":["田中: 図面確認"],"next":"納期"}';

describe('organizer', () => {
  it('parses fenced and noisy JSON, rejects garbage', () => {
    expect(parseOrganized('```json\n' + json + '\n```')?.decisions).toEqual(['M6にする']);
    expect(parseOrganized('前置き ' + json + ' 後書き')?.next).toBe('納期');
    expect(parseOrganized('not json')).toBeNull();
    expect(parseOrganized('{"topics":"x"}')?.topics).toEqual([]);
  });

  it('renders plain text, omitting empty sections, without next', () => {
    const text = renderOrganized(parseOrganized(json)!);
    expect(text).toBe('【論点】\n・寸法\n【決まったこと】\n・M6にする\n【宿題】\n・田中: 図面確認');
    expect(text).not.toContain('納期');
  });

  it('returns null on failure and truncates the transcript', async () => {
    const prev = parseOrganized(json);
    expect(await organizeTranscript(async () => 'oops', 'a', prev)).toBeNull();
    expect(await organizeTranscript(async () => { throw new Error('x'); }, 'a', prev)).toBeNull();
    const msgs = buildOrganizeMessages('x'.repeat(20000), prev);
    expect(msgs[1].content.length).toBeLessThan(13000);
    expect(msgs[1].content).toContain('前回の整理');
  });
});

describe('LiveMeetingSession', () => {
  it('organises on an interval and once at end, then emits done', async () => {
    let t = 0; let calls = 0;
    const out: LiveMessage[] = [];
    const frame = (amp: number) => { const b = Buffer.alloc(960); for (let i = 0; i < 480; i++) b.writeInt16LE(i % 2 ? amp : -amp, i * 2); return b; };
    const s = new LiveMeetingSession({
      transcribe: async () => '発言', complete: async () => { calls++; return json; },
      emit: (m) => out.push(m), now: () => t, organizeIntervalMs: 20000, segmenter: { partialIntervalMs: 100000 }
    });
    const speak = () => { for (let i = 0; i < 20; i++) s.push(frame(3000)); for (let i = 0; i < 30; i++) s.push(frame(0)); };
    speak(); await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(0);
    t = 25000; speak(); await new Promise((r) => setTimeout(r, 5));
    expect(calls).toBe(1);
    speak();
    await s.end();
    expect(calls).toBe(2);
    expect(out.filter((m) => m.type === 'final')).toHaveLength(3);
    expect(out.filter((m) => m.type === 'doc')[0]).toMatchObject({ type: 'doc', next: '納期' });
    expect(out.at(-1)).toEqual({ type: 'done' });
  });
});
