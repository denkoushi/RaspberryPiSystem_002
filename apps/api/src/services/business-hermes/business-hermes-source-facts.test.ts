import { describe, expect, it } from 'vitest';
import { prepareSourceFact } from './business-hermes-source-facts.js';
import { sourceFingerprint } from './business-hermes-answer-cache.js';

const record = { kind: 'nonconformity', id: 'n1', nonconformityNo: '123', partNumber: 'MD001',
  condition: '上限80℃。設計へ相談してから加工。', correctiveContent: '確認なしで進めない。', provenance: { activeLatest: true } };
function prepare(r: Record<string, unknown>) {
  const detail = { content: [{ type: 'text', text: JSON.stringify(r) }] };
  return prepareSourceFact(detail, { kind: String(r.kind), id: String(r.id), sha256: sourceFingerprint(detail) }, '2026-09-14');
}
describe('Source-exact fact preparation', () => {
  it('keeps conditions, units, provenance scope and missing fields explicit without model judgment', () => {
    const fact = prepare(record)!;
    expect(fact.question).toBe('不適合記録123・図番MD001の記録内容は？');
    expect(fact.answer).toContain('不適合内容：上限80℃。設計へ相談してから加工。');
    expect(fact.answer).toContain('個別是正内容：確認なしで進めない。');
    expect(fact.answer).toContain('処置内容：未記録');
    expect(fact.answer).toContain('現在の作業指示ではありません');
    expect(fact.queries).toEqual([fact.question]);
  });
  it('uses the unique record number when the source explicitly has no drawing number', () => {
    const fact = prepare({ ...record, partNumber: null })!;
    expect(fact.question).toBe('不適合記録123の記録内容は？');
    expect(fact.answer).toContain('図番：未記録');
    expect(fact.answer).toContain('不適合内容：上限80℃。設計へ相談してから加工。');
    expect(prepare({ ...record, partNumber: null, nonconformityNo: null })).toBeNull();
  });
  it('rejects stale, unscoped, oversized and invalid field sources', () => {
    for (const r of [{ ...record, provenance: { activeLatest: false } }, { ...record, partNumber: '' },
      { ...record, condition: '長'.repeat(4001) }, { ...record, condition: 80 }]) expect(prepare(r)).toBeNull();
    expect(prepareSourceFact({ content: [] }, { kind: 'nonconformity', id: 'n1', sha256: 'a'.repeat(64) }, '')).toBeNull();
  });
  it('quotes all ordered published steps and rejects drafts or multiple ambiguous rows', () => {
    const r = { kind: 'work_instruction', id: 'w1', partNumber: 'MD001', shootingTarget: '加工', public: true,
      rows: [{ publication: { publishedVersionId: 'v1' }, sourceVersionDate: '2026-09-01',
        steps: [{ step: 1, effectiveText: '設計へ相談してから加工。上限80℃。' }, { step: 2, effectiveText: '確認なしで進めない。' }] }] };
    const fact = prepare(r)!;
    expect(fact.answer).toContain('手順1：設計へ相談してから加工。上限80℃。\n手順2：確認なしで進めない。');
    expect(prepare({ ...r, public: false })).toBeNull();
    expect(prepare({ ...r, rows: [...r.rows, ...r.rows] })).toBeNull();
  });
});
