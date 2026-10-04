import type { KnowledgeProcedureDocument } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { knowledgeProcedureRow, retrievalSourceIdsFromEnv } from '../hermes-search-sources.js';

const document: KnowledgeProcedureDocument & { publishedAt: string } = {
  formatVersion: 1, procedureId: 'p1', revisionId: 'r1', revisionNumber: 1,
  title: 'ブラケット溶接', category: '組立', identifiers: { partNumber: 'P1', drawingNumber: 'D1', processName: '溶接' },
  reviewTier: 'approval_required', state: 'published', createdAt: '2026-09-01T00:00:00Z', publishedAt: '2026-10-03T15:00:00Z',
  steps: [
    { id: 's1', title: '準備', body: '原文を保持。', cautions: ['保護具を着用', '向きを確認'], needsReview: ['非検索欄'], photos: [], sources: [{ kind: 'note', ref: 'n1', label: '原資料' }] },
    { id: 's2', title: '溶接', body: '固定して溶接。', cautions: ['温度に注意'], needsReview: [], photos: [], sources: [{ kind: 'note', ref: 'n2', label: '原資料2' }] },
  ],
};

describe('Hermes retrieval source rows', () => {
  it('flattens original published steps and cautions and uses the JST publication date', () => {
    expect(knowledgeProcedureRow(document)).toEqual({
      kind: 'knowledge_procedure', id: 'p1', title: 'ブラケット溶接', category: '組立',
      partNumber: 'P1', drawingNumber: 'D1', processName: '溶接', publishedOn: '2026-10-04',
      stepsText: '1. 準備\n原文を保持。\n\n2. 溶接\n固定して溶接。', cautionsText: '保護具を着用\n向きを確認\n温度に注意',
    });
  });

  it('keeps missing identifiers and empty cautions as empty strings', () => {
    const row = knowledgeProcedureRow({ ...document, identifiers: {}, steps: document.steps.map(step => ({ ...step, cautions: [] })) });
    expect([row.partNumber, row.drawingNumber, row.processName, row.cautionsText]).toEqual(['', '', '', '']);
    expect(() => knowledgeProcedureRow({ ...document, publishedAt: 'invalid' })).toThrow(RangeError);
  });

  it('defaults to nonconformity and preserves configured order without duplicates', () => {
    for (const value of [undefined, '', ' , ']) expect(retrievalSourceIdsFromEnv({ HERMES_RETRIEVAL_SOURCES: value })).toEqual(['nonconformity']);
    expect(retrievalSourceIdsFromEnv({ HERMES_RETRIEVAL_SOURCES: ' knowledge_procedure,nonconformity,knowledge_procedure ' })).toEqual(['knowledge_procedure', 'nonconformity']);
  });

  it('rejects unknown ids with the same message as the worker', () => {
    for (const id of ['missing', 'constructor']) expect(() => retrievalSourceIdsFromEnv({ HERMES_RETRIEVAL_SOURCES: `nonconformity,${id}` })).toThrow(`unknown retrieval source: ${id}`);
  });
});
