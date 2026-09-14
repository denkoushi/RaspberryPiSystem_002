import { describe, expect, it } from 'vitest';
import { evaluationSchema, overlapsNightQuestion, selectNightDocuments, validateDocumentQuestion } from './business-hermes-nightly-candidates.js';
import { sourceFingerprint } from './business-hermes-answer-cache.js';

describe('Document question selection and filtering', () => {
  const document = { kind: 'work_instruction', id: 'one', title: '検査', text: '設計へ相談してから加工。', identifiers: ['MD001'] };
  it('selects documents without conversations and rotates past attempted documents', () => {
    const documents = Array.from({ length: 10 }, (_, i) => ({ ...document, id: String(i) }));
    const selected = selectNightDocuments(documents, [], [], {}, 1000);
    expect(selected).toHaveLength(4);
    const attempts = Object.fromEntries(selected.map(s => [s.key, { sha256: s.sha256, attemptedAt: 1000 }]));
    const next = selectNightDocuments(documents, [], [], attempts, 2000);
    expect(next).toHaveLength(4);
    expect(next.some(s => selected.some(previous => previous.key === s.key))).toBe(false);
  });
  it('prioritizes changed documents and negative-feedback demand', () => {
    const other = { ...document, id: 'two' };
    const changed = { ...document, text: '更新された条件' };
    const attempts = { 'work_instruction:one': { sha256: sourceFingerprint(document), attemptedAt: 1000 } };
    expect(selectNightDocuments([other, changed], [], [], attempts, 2000)[0]?.document).toEqual(changed);
    expect(selectNightDocuments([document, other], [], [{ sources: [other], verdict: 'unhelpful' }], {}, 2000)[0]?.document).toEqual(other);
  });
  it('rejects omitted identities, invented numbers and evaluation copies', () => {
    const evidence = { partNumber: 'MD001', text: '設計へ相談してから加工。' };
    expect(validateDocumentQuestion('MD001を加工する前に必要なことは？', ['MD001'], evidence, [])).toBeNull();
    expect(validateDocumentQuestion('加工する前に必要なことは？', ['MD001'], evidence, [])).toBe('missing_source_identity');
    expect(validateDocumentQuestion('MD001を20mm加工してよい？', ['MD001'], evidence, [])).toBe('unsupported_number');
    expect(validateDocumentQuestion('MD001を加工する前に必要なことは？', ['MD001'], evidence,
      ['ＭＤ００１を加工する前に必要なことは？'])).toBe('duplicate_or_protected');
    expect(overlapsNightQuestion('MD001を加工する前に必要なことは何ですか？', ['MD001を加工する前に必要なことは何ですか'])).toBe(true);
    expect(overlapsNightQuestion('公開要領：MD001・加工：加工前の設計相談について教えて', ['加工前の設計相談について教えて'])).toBe(true);
    expect(overlapsNightQuestion('工具の保管方法を教えて', ['加工前の確認を教えて'])).toBe(false);
  });
});


it('accepts explicit abstention sources without weakening identified source validation', () => {
  const data = { version: 1, cases: Array.from({length: 4}, (_, i) => ({id: String(i), question: '未記録' + i, expectedSource: null})) };
  expect(evaluationSchema.parse(data).cases.every(c => c.expectedSource === null)).toBe(true);
  expect(evaluationSchema.safeParse({...data, cases: [{...data.cases[0], expectedSource:{kind:'nonconformity', id:'one', sha256:'invalid'}}, ...data.cases.slice(1)]}).success).toBe(false);
});
