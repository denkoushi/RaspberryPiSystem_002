import { describe, expect, it } from 'vitest';

import { mergeSummaryCandidatesWithLlmFirst } from '../kiosk-document-summary-merge.js';

describe('mergeSummaryCandidatesWithLlmFirst', () => {
  it('returns mechanical only when llm null', () => {
    const text = '目的：品質を保つ。\n\n本文が続く。'.repeat(5);
    const got = mergeSummaryCandidatesWithLlmFirst(text, null);
    expect(got[0]).toBeDefined();
    expect(got[0]).toContain('目的');
  });

  it('puts llm first and adds distinct mechanical snippets', () => {
    const text = '目的：安全に作業する。\n\n別段落で詳細。'.repeat(8);
    const got = mergeSummaryCandidatesWithLlmFirst(text, 'LLM要約一行');
    expect(got[0]).toBe('LLM要約一行');
    expect(got[1]).toBeDefined();
    expect(got[1]).not.toBe(got[0]);
  });
});
