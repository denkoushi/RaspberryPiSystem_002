import { describe, expect, it } from 'vitest';
import { buildProcedureCaptionLearningPrompt } from '../procedure-caption-learning-prompt.js';

describe('procedure caption learning prompt', () => {
  it.each(['1. ', '１２．', '2) ', '・'])('strips the leading list marker (%s)', prefix => {
    expect(buildProcedureCaptionLearningPrompt([{ aiText: '台を置く', finalText: `${prefix}コマを置く` }]))
      .toContain('AI: "台を置く" → 人: "コマを置く"');
  });
  it('returns nothing without eligible examples', () => {
    expect(buildProcedureCaptionLearningPrompt([])).toBe('');
    expect(buildProcedureCaptionLearningPrompt([
      { aiText: 'x', finalText: null }, { aiText: 'x', finalText: '・ ' },
      { aiText: 'x', finalText: '使用治具\n・コマ' },
      { aiText: 'x', finalText: '1. 配置\r\n2. 固定' },
      { aiText: 'x', finalText: '架'.repeat(31) }
    ])).toBe('');
  });
  it('accepts exactly 30 characters after removing numbering and counts Unicode characters', () => {
    expect(buildProcedureCaptionLearningPrompt([{ aiText: 'x', finalText: '1. ' + '😀'.repeat(30) }])).toContain('AI:');
  });
  it('deduplicates normalized pairs, keeps recency and caps at five', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ aiText: `台${i}`, finalText: `1. コマ${i}` }));
    const result = buildProcedureCaptionLearningPrompt([rows[0], { ...rows[0], finalText: '・コマ0' }, ...rows]);
    expect(result.match(/AI:/g)).toHaveLength(5);
    expect(result).not.toContain('コマ5');
    expect(result.indexOf('コマ0')).toBeLessThan(result.indexOf('コマ1'));
  });
  it('escapes examples and warns against copying quantities and names', () => {
    const result = buildProcedureCaptionLearningPrompt([{ aiText: '台\n"例"', finalText: 'コマ"例"' }]);
    expect(result).toContain('個数や品名を他の写真に持ち込まない');
    expect(result).toContain('AI: "台\\n\\"例\\"" → 人: "コマ\\"例\\""');
  });
});
