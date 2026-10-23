import { describe, expect, it } from 'vitest';
import { buildProcedureTextLearningPrompt } from '../procedure-text-learning-prompt.js';

describe('procedure text learning prompt', () => {
  it('adds nothing without eligible examples or terms', () => {
    expect(buildProcedureTextLearningPrompt([], [])).toBe('');
    expect(buildProcedureTextLearningPrompt([
      { aiText: 'x', finalText: null }, { aiText: 'x'.repeat(201), finalText: 'x' },
      { aiText: 'x', finalText: 'x'.repeat(201) }
    ], [])).toBe('');
  });
  it('deduplicates, caps at five and prefers small edits without changing recency within the preference', () => {
    const large = { aiText: 'abc', finalText: 'xyz' };
    const multiline = { aiText: 'abc', finalText: 'ab\nc' };
    const small = Array.from({ length: 6 }, (_, i) => ({ aiText: `工程${i}を固定します`, finalText: `工程${i}を固定する` }));
    const result = buildProcedureTextLearningPrompt([large, multiline, ...small, small[0]], []);
    expect(result.match(/AI:/g)).toHaveLength(5);
    expect(result).not.toContain('"abc"');
    expect(result).not.toContain('工程5');
    expect(result.indexOf('工程0')).toBeLessThan(result.indexOf('工程1'));
    expect(buildProcedureTextLearningPrompt([small[0], small[0]], []).match(/AI:/g)).toHaveLength(1);
  });
  it('escapes examples, retains the warning and includes learned terms', () => {
    const result = buildProcedureTextLearningPrompt([{ aiText: '誤語\n"例"', finalText: '正語\n"例"' }], [{ wrongText: '誤語', rightText: '正語' }]);
    expect(result).toContain('中の数値や品名を他の text に持ち込まない');
    expect(result).toContain('AI: "誤語\\n\\"例\\"" → 人: "正語\\n\\"例\\""');
    expect(result).toContain('人の直しから覚えた言い直し:\n「誤語」→「正語」\n');
  });
  it('accepts 200 characters and an edit distance of exactly half', () => {
    const result = buildProcedureTextLearningPrompt([{ aiText: '😀'.repeat(200), finalText: '😀'.repeat(100) + 'x'.repeat(100) }], []);
    expect(result).toContain('AI:');
  });
});
