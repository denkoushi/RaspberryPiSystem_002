import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadCatalog } from './catalog.mjs';
import { authorizedRecords } from './corpus.mjs';
import { createRetrievalAnswering } from './worker.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Captured before the source registration refactor, including JSON property order.
const expectedCatalog = '67863d23315a76f9a91e0dc12bf556f71e0fb5f2252759fde7ad1067a8b59411';
// Inputs re-captured on 2026-10-19 when the planner gained the intent choice question (plans and answers unchanged).
const expectedInputs = 'e9e552d1c93da743d7c20b605ce2d1a373d34b6e7fdcf0bfa0d955fdb91ed583';
const expectedResults = '06dc45f2b0441d9a59196d6e6e8444e9e93b8726f7a5ac29116aa88749d0fb3a';

test('existing two sources preserve catalog bytes, JEV inputs, plans, candidates and answers', async () => {
  const catalog = loadCatalog(['nonconformity', 'knowledge_procedure']);
  const records = authorizedRecords([
    { kind: 'nonconformity', id: 'shared', nonconformityNo: 'N1', partNumber: 'N', condition: 'ブラケット溶接の不適合', discoveredOn: '2026-10-01' },
    { kind: 'knowledge_procedure', id: 'shared', title: 'ブラケット溶接', partNumber: 'P', drawingNumber: 'D1', stepsText: 'ブラケット溶接の手順原文', cautionsText: '保護具を着用', publishedOn: '2026-10-02' },
  ], catalog);
  const inputs = [];
  const evaluate = async (input) => {
    inputs.push(input);
    const answers = {};
    for (const key of Object.keys(input.questions)) {
      if (key.startsWith('candidate_')) answers[key] = { type: 'noul', noul: 0.95 };
      else if (key.startsWith('field_')) answers[key] = { type: 'choice', choice: 'none' };
    }
    answers.scope = { type: 'choice', choice: 'knowledge_procedure' };
    answers.content = { type: 'noul', noul: 0.95 };
    answers.sort = { type: 'choice', choice: 'relevance' };
    answers.limit = { type: 'choice', choice: 'unspecified' };
    return { answers };
  };
  const results = [];
  for (const ids of [['nonconformity'], ['knowledge_procedure'], ['nonconformity', 'knowledge_procedure']]) {
    const answering = createRetrievalAnswering({ records, catalog: loadCatalog(ids), evaluate });
    for (const entity of [null, { kind: 'partNumber', value: 'P' }, { kind: 'drawingNumber', value: 'D1' }, { kind: 'procedureId', value: 'shared' }]) {
      const result = await answering.answer(entity ? 'この記録のブラケット溶接' : 'ブラケット溶接', null, {
        stageDump: true, ...(entity ? { pageContext: { path: '/synthetic', entity } } : {}),
      });
      results.push({ answer: result.answer, recordIds: result.recordIds, candidateIds: result.candidateIds,
        plan: result.session.previousPlan, receiptPlan: result.receipt?.plan });
    }
  }
  assert.equal(digest(catalog), expectedCatalog);
  assert.equal(digest(inputs), expectedInputs);
  assert.equal(digest(results), expectedResults);
});
