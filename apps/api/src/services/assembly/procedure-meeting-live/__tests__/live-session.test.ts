import { describe, expect, it } from 'vitest';

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
