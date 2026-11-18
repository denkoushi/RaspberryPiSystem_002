import { createHash } from 'node:crypto';
import type { AssemblyProcedureTextFeedback } from '@prisma/client';
import type { ProcedureDictationLearning, ProcedureDictationRewriteInput } from './procedure-dictation-prompt.js';
import { characterEditDistance, smallEdit } from './procedure-text-learning-prompt.js';

export type DictationCase = ProcedureDictationRewriteInput & { id: string; expected: string };
export type DictationFeedback = Pick<AssemblyProcedureTextFeedback,
  'id' | 'mode' | 'spokenText' | 'originalText' | 'aiText' | 'finalText' | 'outcome'>;

export function dictationFeedbackSplit(spokenText: string, finalText: string): 'improvement' | 'confirmation' {
  const pair = JSON.stringify([spokenText.normalize('NFKC').trim(), finalText.normalize('NFKC').trim()]);
  return createHash('sha256').update(pair).digest()[0] % 2 === 0 ? 'improvement' : 'confirmation';
}

export function dictationFeedbackCase(row: DictationFeedback): DictationCase | null {
  const { id, mode, spokenText, originalText, aiText, finalText, outcome } = row;
  if (mode !== 'new' && mode !== 'append' && mode !== 'revise') return null;
  const currentText = mode === 'new' ? undefined : originalText;
  if (!spokenText || !finalText || [spokenText, finalText, currentText ?? ''].some(text => Array.from(text).length > 1000)) return null;
  if (outcome !== 'KEPT') {
    if (outcome !== 'EDITED') return null;
    // The length difference alone exceeds the small-edit threshold in this case.
    if (Array.from(aiText).length > 2 * Array.from(finalText).length || !smallEdit(aiText, finalText)) return null;
  }
  return { id, mode, spokenText, ...(currentText === undefined ? {} : { currentText }), expected: finalText };
}

type CaseScore = { score: number; numberMiss: boolean };
const numbers = (text: string) => text.normalize('NFKC').replace(/[−－]/g, '-').match(/-?\d+(?:\.\d+)?/g) ?? [];

function missesSpokenNumbers(spokenText: string, output: string): boolean {
  const counts = new Map<string, number>();
  for (const number of numbers(output)) counts.set(number, (counts.get(number) ?? 0) + 1);
  for (const number of numbers(spokenText)) {
    const count = counts.get(number) ?? 0;
    if (!count) return true;
    counts.set(number, count - 1);
  }
  return false;
}

export function scoreDictation(test: DictationCase, output: string | null): CaseScore {
  if (output === null) return { score: 1, numberMiss: false };
  if (test.mode !== 'revise' && missesSpokenNumbers(test.spokenText, output)) return { score: 1, numberMiss: true };
  if (Array.from(output).length > 4000) return { score: 1, numberMiss: false };
  const written = Array.from(test.mode === 'append' ? (test.currentText ?? '') + '\n' + output : output);
  const expected = Array.from(test.expected);
  let start = 0;
  while (start < written.length && start < expected.length && written[start] === expected[start]) start++;
  let writtenEnd = written.length, expectedEnd = expected.length;
  while (writtenEnd > start && expectedEnd > start && written[writtenEnd - 1] === expected[expectedEnd - 1]) {
    writtenEnd--;
    expectedEnd--;
  }
  const distance = characterEditDistance(written.slice(start, writtenEnd), expected.slice(start, expectedEnd));
  return { score: distance / Math.max(written.length, expected.length, 1), numberMiss: false };
}

export type DictationEvaluationSnapshot = {
  dictationEvalCases: number | null;
  dictationBaselineScore: number | null;
  dictationCandidateScore: number | null;
  dictationBaselineNumberMisses: number | null;
  dictationCandidateNumberMisses: number | null;
  dictationLearningAdopted: boolean;
  dictationLearning: ProcedureDictationLearning | null;
};

export function summarizeDictationEvaluation(pairs: { baseline: CaseScore; candidate: CaseScore }[]) {
  let wins = 0, losses = 0, baselineTotal = 0, candidateTotal = 0, baselineMisses = 0, candidateMisses = 0;
  for (const { baseline, candidate } of pairs) {
    if (candidate.score < baseline.score) wins++;
    if (candidate.score > baseline.score) losses++;
    baselineTotal += baseline.score;
    candidateTotal += candidate.score;
    baselineMisses += Number(baseline.numberMiss);
    candidateMisses += Number(candidate.numberMiss);
  }
  return {
    wins, losses,
    dictationEvalCases: pairs.length,
    dictationBaselineScore: pairs.length ? baselineTotal / pairs.length : null,
    dictationCandidateScore: pairs.length ? candidateTotal / pairs.length : null,
    dictationBaselineNumberMisses: baselineMisses,
    dictationCandidateNumberMisses: candidateMisses,
    dictationLearningAdopted: pairs.length > 0 && wins > losses && candidateTotal <= baselineTotal && candidateMisses <= baselineMisses,
  };
}
