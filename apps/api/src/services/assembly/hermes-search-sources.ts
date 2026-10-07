import type { KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

import type { createTorqueTrainingSourceReaders } from '../torque-training/torque-training-hermes-source.service.js';

export type RetrievalSourceReader = () => Promise<Array<Record<string, unknown>>>;
type ReaderContext = {
  nonconformity: RetrievalSourceReader;
  procedures: RetrievalSourceReader;
  training: () => ReturnType<typeof createTorqueTrainingSourceReaders>;
};

// The only API registration point. Reader factories receive code-owned dependencies.
export const RETRIEVAL_SOURCE_READERS = {
  nonconformity: (context: ReaderContext) => context.nonconformity,
  knowledge_procedure: (context: ReaderContext) => context.procedures,
  torque_training_session: (context: ReaderContext) => context.training().torque_training_session,
  torque_training_operator: (context: ReaderContext) => context.training().torque_training_operator,
  torque_training_team: (context: ReaderContext) => context.training().torque_training_team,
} satisfies Record<string, (context: ReaderContext) => RetrievalSourceReader>;
export type RetrievalSourceId = keyof typeof RETRIEVAL_SOURCE_READERS;
export const RETRIEVAL_SOURCE_IDS = Object.keys(RETRIEVAL_SOURCE_READERS) as RetrievalSourceId[];

export function registeredSourceReaders(context: ReaderContext, ids: RetrievalSourceId[]): RetrievalSourceReader[] {
  return ids.map(id => RETRIEVAL_SOURCE_READERS[id](context));
}

export function retrievalSourceIdsFromEnv(env: NodeJS.ProcessEnv = process.env): RetrievalSourceId[] {
  const ids = [...new Set((env.HERMES_RETRIEVAL_SOURCES ?? '').split(',').map(id => id.trim()).filter(Boolean))];
  if (!ids.length) return ['nonconformity'];
  return ids.map(id => {
    const known = RETRIEVAL_SOURCE_IDS.find(sourceId => sourceId === id);
    if (!known) throw new Error(`unknown retrieval source: ${id}`);
    return known;
  });
}

// The published summary owns publishedAt; getPublished supplies the revision body.
export function knowledgeProcedureRow(document: KnowledgeProcedureDocument & Pick<KnowledgeProcedureSummary, 'publishedAt'>): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(document.publishedAt));
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return {
    kind: 'knowledge_procedure',
    id: document.procedureId,
    title: document.title,
    category: document.category,
    partNumber: document.identifiers.partNumber ?? '',
    drawingNumber: document.identifiers.drawingNumber ?? '',
    processName: document.identifiers.processName ?? '',
    publishedOn: `${pick('year')}-${pick('month')}-${pick('day')}`,
    stepsText: document.steps.map((step, index) => `${index + 1}. ${step.title}\n${step.body}`).join('\n\n'),
    cautionsText: document.steps.flatMap(step => step.cautions).join('\n'),
  };
}
