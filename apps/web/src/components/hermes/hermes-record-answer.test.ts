import { describe, expect, it } from 'vitest';

import { formatRecordBody } from './hermes-record-answer';

describe('formatRecordBody', () => {
  it('splits sentences per line, trims whitespace and drops empty sentences', () => {
    expect(formatRecordBody(' 一文目。 二文目。。 \n\n 次の行。\r\n2回目: 9.8 N·m ')).toEqual([
      { items: ['一文目', '二文目'] }, { items: ['次の行'] }, { items: ['2回目: 9.8 N·m'] },
    ]);
  });

  it('promotes a prefix of exactly 16 characters only for a line with multiple sentences', () => {
    const prefix = '訓練条件'.repeat(4);
    expect(formatRecordBody(`${prefix}: 最初。次。`)).toEqual([{ heading: prefix, items: ['最初', '次'] }]);
    expect(formatRecordBody(`${prefix.slice(1)}: 最初。次。`)).toEqual([{ items: [`${prefix.slice(1)}: 最初`, '次'] }]);
    expect(formatRecordBody(`${prefix}: 一文だけ。`)).toEqual([{ items: [`${prefix}: 一文だけ`] }]);
    expect(formatRecordBody('全期間: 訓練12セッション。締付60回。')).toEqual([{ items: ['全期間: 訓練12セッション', '締付60回'] }]);
  });

  it('keeps a long condition heading and internal colons in the remaining text', () => {
    const heading = 'M8締付訓練 / 長さ30 mm / 治具JIG-01';
    expect(formatRecordBody(`${heading}: 2回目: 9.8 N·m。合格。`)).toEqual([
      { heading, items: ['2回目: 9.8 N·m', '合格'] },
    ]);
  });

  it('returns no groups for empty or whitespace-only values', () => {
    expect(formatRecordBody('')).toEqual([]);
    expect(formatRecordBody(' \n\t　\r\n ')).toEqual([]);
    expect(formatRecordBody('。。')).toEqual([]);
  });
});
