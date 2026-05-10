import { describe, expect, it } from 'vitest';

import {
  mergeStackChanDetailSystemPrompt,
  STACKCHAN_DETAIL_SYSTEM_PROMPT_JA,
} from '../stackchan-chat-request.js';

describe('mergeStackChanDetailSystemPrompt', () => {
  it('prepends detail policy when first message is user', () => {
    const merged = mergeStackChanDetailSystemPrompt([{ role: 'user', content: '質問' }]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ role: 'system', content: STACKCHAN_DETAIL_SYSTEM_PROMPT_JA });
    expect(merged[1]).toEqual({ role: 'user', content: '質問' });
  });

  it('appends detail policy when first message is system', () => {
    const merged = mergeStackChanDetailSystemPrompt([
      { role: 'system', content: 'あなたは案内係です。' },
      { role: 'user', content: '質問' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].role).toBe('system');
    expect(merged[0].content).toContain('あなたは案内係です。');
    expect(merged[0].content).toContain(STACKCHAN_DETAIL_SYSTEM_PROMPT_JA);
  });

  it('does not append duplicate detail policy when already present', () => {
    const existingSystem = `あなたは案内係です。\n\n${STACKCHAN_DETAIL_SYSTEM_PROMPT_JA}`;
    const messages = [
      { role: 'system' as const, content: existingSystem },
      { role: 'user' as const, content: '質問' },
    ];

    expect(mergeStackChanDetailSystemPrompt(messages)).toEqual(messages);
  });
});
