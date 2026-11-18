import { readFile } from 'node:fs/promises';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getInferenceRuntime } from '../inference/inference-runtime.js';
import { InferenceDeferredError, type TextCompletionPort } from '../inference/ports/text-completion.port.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import {
  dictationFeedbackCase, dictationFeedbackSplit, scoreDictation, summarizeDictationEvaluation, type DictationCase, type DictationEvaluationSnapshot,
} from './procedure-dictation-evaluation.js';
import { dictationFeedbackQuery, loadDictationLearning } from './procedure-dictation-learning.js';
import type { ProcedureDictationLearning } from './procedure-dictation-prompt.js';
import { completeProcedureDictation } from './procedure-dictation-rewrite.service.js';
import type { ProcedureSite } from './procedure-published-examples.js';

async function loadConfirmationCases(site: ProcedureSite, now: Date, signal?: AbortSignal): Promise<DictationCase[]> {
  const file = new URL(`./procedure-dictation-gold/${site}.json`, import.meta.url);
  const cases = JSON.parse(await readFile(file, 'utf8')) as DictationCase[];
  const query = dictationFeedbackQuery(site, now, 'EDITED');
  const take = 100;
  let lastId: string | undefined;
  while (cases.length < 30) {
    signal?.throwIfAborted();
    const rows = await prisma.assemblyProcedureTextFeedback.findMany({
      ...query, take, ...(lastId === undefined ? {} : { cursor: { id: lastId }, skip: 1 }),
    });
    for (const row of rows) {
      if (row.outcome !== 'EDITED') continue;
      const test = dictationFeedbackCase(row);
      if (test && dictationFeedbackSplit(test.spokenText, test.expected) === 'confirmation') cases.push(test);
      if (cases.length === 30) return cases;
    }
    if (rows.length < take) break;
    lastId = rows[rows.length - 1].id;
  }
  return cases;
}

export async function evaluateProcedureDictation(
  site: ProcedureSite,
  options: { now?: Date; text?: TextCompletionPort; signal?: AbortSignal; manageRuntime?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const { signal } = options;
  const background = env.BUSINESS_HERMES_BACKGROUND_ENABLED === 'true';
  const pairs: Parameters<typeof summarizeDictationEvaluation>[0] = [];
  let learning: ProcedureDictationLearning | null = null;
  let failure: { error: unknown } | undefined;
  let failedCalls = 0;
  try {
    const [candidateLearning, cases] = await Promise.all([
      loadDictationLearning(site, now),
      loadConfirmationCases(site, now, signal),
    ]);
    learning = candidateLearning;
    signal?.throwIfAborted();
    const runtime = options.manageRuntime === false ? null : getLocalLlmRuntimeController();
    let held = false;
    try {
      if (cases.length && runtime && !background) {
        await runtime.ensureReady('business_hermes');
        held = true;
      }
      const text = options.text ?? getInferenceRuntime().createTextCompletionPort();
      let deferred = false;
      const measure = async (test: DictationCase, learning?: ProcedureDictationLearning) => {
        if (deferred || signal?.aborted) return;
        let output: string;
        try {
          output = await completeProcedureDictation(text, { ...test, learning, background, signal });
        } catch (error) {
          failure ??= { error };
          deferred = error instanceof InferenceDeferredError;
          failedCalls++;
          return;
        }
        return scoreDictation(test, output);
      };
      for (const test of cases) {
        const baseline = await measure(test);
        const candidate = await measure(test, candidateLearning);
        if (baseline && candidate) pairs.push({ baseline, candidate });
        if (deferred || signal?.aborted) break;
      }
    } finally {
      if (held && runtime) await runtime.release('business_hermes');
    }
    signal?.throwIfAborted();
  } catch (error) {
    failure ??= { error };
  }

  const { wins, losses, ...summary } = summarizeDictationEvaluation(pairs);
  const snapshot: DictationEvaluationSnapshot = {
    ...summary,
    dictationLearningAdopted: !failure && summary.dictationLearningAdopted,
    dictationLearning: learning,
  };
  const result = { site, ...summary, dictationLearningAdopted: snapshot.dictationLearningAdopted, wins, losses, failedCalls, failed: Boolean(failure) };
  if (failure) logger.warn({ err: failure.error, site, failedCalls }, 'assembly_procedure_dictation_evaluation_failed');
  logger.info(result, 'assembly_procedure_dictation_evaluation_completed');
  return { result, snapshot };
}
