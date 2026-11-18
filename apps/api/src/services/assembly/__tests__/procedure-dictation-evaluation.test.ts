import { describe, expect, it, vi } from 'vitest';
import { dictationFeedbackCase, dictationFeedbackSplit, scoreDictation, summarizeDictationEvaluation } from '../procedure-dictation-evaluation.js';
import * as textLearning from '../procedure-text-learning-prompt.js';

describe('dictation evaluation', () => {
  it('splits by SHA-256 of the trimmed, NFKC-normalized text pair', () => {
    expect(dictationFeedbackSplit('abc', 'def')).toBe('confirmation'); // 99
    expect(dictationFeedbackSplit(' Ａ ', '\nＢ\n')).toBe('improvement'); // b6
    expect(dictationFeedbackSplit(' Ａ ', '\nＢ\n')).toBe(dictationFeedbackSplit('A', 'B'));
  });

  it.each(['spokenText', 'finalText', 'originalText'] as const)('rejects oversized %s before smallEdit', field => {
    const smallEdit = vi.spyOn(textLearning, 'smallEdit');
    const text = '𠮷'.repeat(1000);
    const row = { id: 'length', mode: 'append', spokenText: '発話', originalText: '既存。', aiText: text, finalText: text, outcome: 'EDITED' as const };
    try {
      expect(dictationFeedbackCase({ ...row, [field]: text + '𠮷' })).toBeNull();
      expect(smallEdit).not.toHaveBeenCalled();
      expect(dictationFeedbackCase({ ...row, [field]: text })).not.toBeNull();
      expect(smallEdit).toHaveBeenCalledOnce();
    } finally {
      smallEdit.mockRestore();
    }
  });

  it('uses kept and small edits, and supplies the original text in append and revise modes', () => {
    const row = { id: 'abc', mode: 'new', spokenText: '棚に直して', originalText: '既存。', aiText: '棚に直す。', finalText: '棚に戻す。' };
    expect(dictationFeedbackCase({ ...row, outcome: 'KEPT' })).toEqual({ id: 'abc', mode: 'new', spokenText: row.spokenText, expected: row.finalText });
    for (const mode of ['append', 'revise']) {
      expect(dictationFeedbackCase({ ...row, mode, outcome: 'EDITED' })).toMatchObject({ mode, currentText: row.originalText, expected: row.finalText });
    }
    expect(dictationFeedbackCase({ ...row, finalText: '部品を締め付ける。', outcome: 'EDITED' })).toBeNull();
    for (const outcome of ['REVERTED', 'PROPOSED'] as const) {
      expect(dictationFeedbackCase({ ...row, outcome })).toBeNull();
    }
    expect(dictationFeedbackCase({ ...row, outcome: 'KEPT', mode: null })).toBeNull();
  });

  it('scores the editor text including the appended newline and counts Unicode characters', () => {
    const test = { id: 'append', mode: 'append', spokenText: '棚に戻す', currentText: '𠮷。', expected: '𠮷。\n棚に戻す。' } as const;
    expect(scoreDictation(test, '棚に戻す。')).toEqual({ score: 0, numberMiss: false });
    expect(scoreDictation(test, '棚に返す。').score).toBe(1 / 8);
    expect(scoreDictation(test, null)).toEqual({ score: 1, numberMiss: false });
  });

  it('requires every spoken number as a whole token after NFKC normalization', () => {
    const test = { id: 'numbers', mode: 'append', spokenText: '１２．５ N·mで２本締める', currentText: '2本。', expected: '2本。\n12.5 N·mで2本締める。' } as const;
    expect(scoreDictation(test, '12.5 N·mで2本締める。')).toEqual({ score: 0, numberMiss: false });
    expect(scoreDictation(test, '12.5 N·mで締める。')).toEqual({ score: 1, numberMiss: true });
    expect(scoreDictation(test, '112.5 N·mで2本締める。')).toEqual({ score: 1, numberMiss: true });
  });

  it('preserves signed numbers with their multiplicity and allows extra copies', () => {
    const expected = '-12.5を2回、-12.5を測る。';
    const test = { id: 'signed', mode: 'new', spokenText: '−１２．５を２回、－１２．５を測る', expected } as const;
    expect(scoreDictation(test, expected)).toEqual({ score: 0, numberMiss: false });
    expect(scoreDictation(test, expected + ' -12.5').numberMiss).toBe(false);
    expect(scoreDictation(test, '12.5を2回、-12.5を測る。')).toEqual({ score: 1, numberMiss: true });
  });

  it('allows a revision to replace a number', () => {
    const test = { id: 'revise', mode: 'revise', spokenText: '16を18にして', currentText: '16個用意する。', expected: '18個用意する。' } as const;
    expect(scoreDictation(test, test.expected)).toEqual({ score: 0, numberMiss: false });
  });

  it('caps scoring work at 4000 output characters', () => {
    const expected = '𠮷'.repeat(4000);
    const test = { id: 'length', mode: 'new', spokenText: '発話', expected } as const;
    expect(scoreDictation(test, expected).score).toBe(0);
    expect(scoreDictation(test, expected + '𠮷').score).toBe(1);
  });

  it('uses paired wins and losses, rejects additional number misses and needs at least one case', () => {
    const better = { score: 0.1, numberMiss: false }, worse = { score: 0.9, numberMiss: false };
    const win = { baseline: worse, candidate: better }, loss = { baseline: better, candidate: worse };
    expect(summarizeDictationEvaluation([win, loss])).toMatchObject({
      wins: 1, losses: 1, dictationEvalCases: 2, dictationBaselineScore: 0.5, dictationCandidateScore: 0.5, dictationLearningAdopted: false,
    });
    expect(summarizeDictationEvaluation([win]).dictationLearningAdopted).toBe(true);
    expect(summarizeDictationEvaluation([loss]).dictationLearningAdopted).toBe(false);
    expect(summarizeDictationEvaluation([win, win, { baseline: better, candidate: { score: 1, numberMiss: true } }])).toMatchObject({
      dictationBaselineNumberMisses: 0, dictationCandidateNumberMisses: 1, dictationLearningAdopted: false,
    });
    expect(summarizeDictationEvaluation([{ baseline: better, candidate: better }]).dictationLearningAdopted).toBe(false);
    expect(summarizeDictationEvaluation([])).toMatchObject({ dictationEvalCases: 0, dictationBaselineScore: null, dictationLearningAdopted: false });
  });

  it('rejects a higher mean score even when the candidate wins more cases', () => {
    const score = (score: number) => ({ score, numberMiss: false });
    const win = { baseline: score(0.25), candidate: score(0.125) };
    expect(summarizeDictationEvaluation([win, win, { baseline: score(0), candidate: score(0.75) }])).toMatchObject({
      wins: 2, losses: 1, dictationLearningAdopted: false,
    });
    expect(summarizeDictationEvaluation([win, win, { baseline: score(0), candidate: score(0.25) }]).dictationLearningAdopted).toBe(true);
  });
});
