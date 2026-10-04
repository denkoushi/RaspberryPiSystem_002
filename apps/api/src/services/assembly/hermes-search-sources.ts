import type { KnowledgeProcedureDocument, KnowledgeProcedureSummary } from '@raspi-system/shared-types';

export const RETRIEVAL_SOURCE_IDS = ['nonconformity', 'knowledge_procedure'] as const;
export type RetrievalSourceId = typeof RETRIEVAL_SOURCE_IDS[number];
export type RetrievalSourceReader = () => Promise<Array<Record<string, unknown>>>;

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
