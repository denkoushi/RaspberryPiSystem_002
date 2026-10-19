import { describe, expect, it } from 'vitest';

import type { AssemblyProcedureTextCandidate } from '../assembly-procedure-text-candidate.port.js';
import { groupAssemblyProcedureTextCandidates } from '../text-candidate-line-grouping.js';

function candidate(
  text: string,
  xRatio: number,
  yRatio: number,
  overrides: Partial<AssemblyProcedureTextCandidate> = {},
): AssemblyProcedureTextCandidate {
  return {
    text,
    confidence: 0.9,
    bounds: { xRatio, yRatio, widthRatio: 0.04, heightRatio: 0.1 },
    pageIndex: 2,
    source: 'coordinate-ocr',
    ...overrides,
  };
}

describe('groupAssemblyProcedureTextCandidates', () => {
  it('restores fragmented Japanese text in left-to-right order', () => {
    const input = [
      candidate('造', 0.14, 0.1),
      candidate('ダ', 0.38, 0.1),
      candidate('製', 0.08, 0.1),
      candidate('ー', 0.32, 0.1),
      candidate('オ', 0.26, 0.1),
    ];

    expect(groupAssemblyProcedureTextCandidates(input).map(({ text }) => text)).toEqual([
      '製造オーダ',
    ]);
  });

  it('puts the full selection first and then each line in reading order', () => {
    const input = [
      candidate('意', 0.16, 0.4),
      candidate('付', 0.14, 0.1),
      candidate('注', 0.08, 0.4),
      candidate('取', 0.08, 0.1),
    ];

    expect(groupAssemblyProcedureTextCandidates(input).map(({ text }) => text)).toEqual([
      '取付\n注意',
      '取付',
      '注意',
    ]);
  });

  it('does not insert spaces or alter Japanese, model numbers, values, or symbols', () => {
    const input = [
      candidate('ボルト', 0.08, 0.1),
      candidate('M8', 0.18, 0.1),
      candidate('×', 0.27, 0.1),
      candidate('20', 0.34, 0.1),
      candidate('。', 0.43, 0.1),
    ];

    expect(groupAssemblyProcedureTextCandidates(input)[0].text).toBe('ボルトM8×20。');
  });

  it('splits distant same-row fragments into separate segments', () => {
    const input = [
      candidate('左', 0.05, 0.1),
      candidate('側', 0.1, 0.1),
      candidate('右', 0.7, 0.1),
      candidate('側', 0.75, 0.1),
    ];

    expect(groupAssemblyProcedureTextCandidates(input).map(({ text }) => text)).toEqual([
      '左側\n右側',
      '左側',
      '右側',
    ]);
  });

  it('compares horizontal gaps in the coordinate space aspect ratio', () => {
    const input = [
      candidate('左', 0.05, 0.1),
      candidate('側', 0.1, 0.1),
      candidate('右', 0.22, 0.1),
      candidate('側', 0.27, 0.1),
    ];

    expect(
      groupAssemblyProcedureTextCandidates(input, 2).map(({ text }) => text),
    ).toEqual(['左側\n右側', '左側', '右側']);
    expect(
      groupAssemblyProcedureTextCandidates(input, 0.5).map(({ text }) => text),
    ).toEqual(['左側右側']);
  });

  it('falls back unchanged for vertical, unpositioned, and singleton input', () => {
    const vertical = [
      candidate('縦', 0.1, 0.1),
      candidate('書', 0.1, 0.3),
      candidate('き', 0.1, 0.5),
    ];
    const unpositioned = [
      candidate('座標', 0.1, 0.1),
      candidate('なし', 0.2, 0.1, { bounds: null }),
    ];
    const singleton = [candidate('単独', 0.1, 0.1)];

    expect(groupAssemblyProcedureTextCandidates(vertical)).toBe(vertical);
    expect(groupAssemblyProcedureTextCandidates(unpositioned)).toBe(unpositioned);
    expect(groupAssemblyProcedureTextCandidates(singleton)).toBe(singleton);
  });

  it('falls back unchanged when source or page differs', () => {
    const mixedSource = [
      candidate('A', 0.1, 0.1),
      candidate('B', 0.2, 0.1, { source: 'poppler' }),
    ];
    const mixedPage = [
      candidate('A', 0.1, 0.1),
      candidate('B', 0.2, 0.1, { pageIndex: 3 }),
    ];

    expect(groupAssemblyProcedureTextCandidates(mixedSource)).toBe(mixedSource);
    expect(groupAssemblyProcedureTextCandidates(mixedPage)).toBe(mixedPage);
  });

  it('aggregates bounds and uses minimum confidence only when all values exist', () => {
    const combined = groupAssemblyProcedureTextCandidates([
      candidate('締', 0.1, 0.2, { confidence: 0.93 }),
      candidate('結', 0.17, 0.22, {
        confidence: 0.81,
        bounds: { xRatio: 0.17, yRatio: 0.22, widthRatio: 0.05, heightRatio: 0.08 },
      }),
    ])[0];
    const unknownConfidence = groupAssemblyProcedureTextCandidates([
      candidate('締', 0.1, 0.2),
      candidate('結', 0.17, 0.2, { confidence: null }),
    ])[0];

    expect(combined).toMatchObject({
      text: '締結',
      confidence: 0.81,
      pageIndex: 2,
      source: 'coordinate-ocr',
    });
    expect(combined.bounds?.xRatio).toBeCloseTo(0.1);
    expect(combined.bounds?.yRatio).toBeCloseTo(0.2);
    expect(combined.bounds?.widthRatio).toBeCloseTo(0.12);
    expect(combined.bounds?.heightRatio).toBeCloseTo(0.1);
    expect(unknownConfidence.confidence).toBeNull();
  });

  it('uses a fixed line anchor so vertically chained fragments do not merge rows', () => {
    const input = [
      candidate('A', 0.1, 0.1),
      candidate('B', 0.16, 0.15),
      candidate('C', 0.22, 0.2),
      candidate('D', 0.28, 0.2),
    ];

    expect(groupAssemblyProcedureTextCandidates(input).map(({ text }) => text)).toEqual([
      'AB\nCD',
      'AB',
      'CD',
    ]);
  });
});
