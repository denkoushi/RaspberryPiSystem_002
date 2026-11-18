import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { documentSite } from './procedure-document-site.js';
import { dictationCaseSplit, dictationFeedbackCase, type DictationFeedback } from './procedure-dictation-evaluation.js';
import { selectDictationExamples, type ProcedureDictationLearning } from './procedure-dictation-prompt.js';
import type { ProcedureSite } from './procedure-published-examples.js';
import { procedureFeedbackLearningWindow } from './procedure-text-feedback.js';

export function dictationFeedbackQuery(site: ProcedureSite, now: Date, outcome: Prisma.AssemblyProcedureTextFeedbackWhereInput['outcome'] = { in: ['KEPT', 'EDITED'] }) {
  return {
    where: {
      site, source: 'DICTATION', outcome,
      mode: { in: ['new', 'append', 'revise'] }, spokenText: { not: null }, finalText: { not: null },
      resolvedAt: procedureFeedbackLearningWindow(now),
    },
    orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, mode: true, spokenText: true, originalText: true, aiText: true, finalText: true, outcome: true },
  } satisfies Prisma.AssemblyProcedureTextFeedbackFindManyArgs;
}

function* improvementExamples(rows: DictationFeedback[]) {
  for (const row of rows) {
    if (row.mode === 'revise') continue;
    const example = dictationFeedbackCase(row);
    if (!example || dictationCaseSplit(example) !== 'improvement') continue;
    const prefix = example.mode === 'append' ? (example.currentText ?? '') + '\n' : '';
    if (!example.expected.startsWith(prefix)) continue;
    yield { mode: example.mode, spokenText: example.spokenText, finalText: example.expected.slice(prefix.length) };
  }
}

export async function loadDictationLearning(site: ProcedureSite, now: Date): Promise<ProcedureDictationLearning> {
  const [vocabulary, terms, rows] = await Promise.all([
    prisma.assemblyProcedureSiteVocabulary.findMany({
      where: { site }, orderBy: [{ documentCount: 'desc' }, { term: 'asc' }], take: 80, select: { term: true },
    }),
    prisma.assemblyProcedureLearnedTerm.findMany({
      where: { site }, orderBy: [{ occurrences: 'desc' }, { documentCount: 'desc' }, { wrongText: 'asc' }], take: 40,
      select: { wrongText: true, rightText: true },
    }),
    prisma.assemblyProcedureTextFeedback.findMany({ ...dictationFeedbackQuery(site, now), take: 50 }),
  ]);
  return { vocabulary: vocabulary.map(row => row.term), terms, examples: selectDictationExamples(improvementExamples(rows)) };
}

const dictationLearningSchema = z.object({
  vocabulary: z.array(z.string()),
  terms: z.array(z.object({ wrongText: z.string(), rightText: z.string() })),
  examples: z.array(z.object({ mode: z.enum(['new', 'append', 'revise']), spokenText: z.string(), finalText: z.string() })),
}) satisfies z.ZodType<ProcedureDictationLearning>;

async function readAdoptedDictationLearning(documentId: string, signal: AbortSignal): Promise<ProcedureDictationLearning | undefined> {
  try {
    const document = await prisma.assemblyProcedureDocument.findUnique({
      where: { id: documentId }, select: { revisionMetadata: { select: { revisionRootId: true } } },
    });
    const root = document?.revisionMetadata?.revisionRootId;
    if (!root || signal.aborted) return;
    const site = await documentSite(root);
    if (!site || signal.aborted) return;
    const snapshot = await prisma.assemblyProcedureLearningSnapshot.findFirst({
      where: { site, dictationLearningAdopted: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { day: 'desc' }],
      select: { dictationLearningAdopted: true, createdAt: true, dictationLearning: true },
    });
    if (signal.aborted || snapshot?.dictationLearningAdopted !== true || snapshot.createdAt.getTime() < Date.now() - 2 * 86400_000) return;
    const parsed = dictationLearningSchema.safeParse(snapshot.dictationLearning);
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    logger.warn({ err: error, documentId }, 'assembly_procedure_dictation_learning_lookup_failed');
  }
}

export async function loadAdoptedDictationLearning(documentId: string, requestSignal: AbortSignal): Promise<ProcedureDictationLearning | undefined> {
  if (requestSignal.aborted) return;
  const timeout = new AbortController();
  const signal = AbortSignal.any([requestSignal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), 1500);
  let stopWaiting: () => void = () => {};
  const cancelled = new Promise<undefined>(resolve => {
    stopWaiting = () => resolve(undefined);
    signal.addEventListener('abort', stopWaiting, { once: true });
  });
  try {
    return await Promise.race([cancelled, readAdoptedDictationLearning(documentId, signal)]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stopWaiting);
  }
}
