import { describe, expect, it } from 'vitest';

import { buildProcedureContent, enforceReviewTier, validateAssignment, type RawStep } from '../procedure-builder.js';
import type { ProcedureMaterial } from '../procedure-material.port.js';

const photo = 'a'.repeat(64);
const otherPhoto = 'b'.repeat(64);
const material = (id: string, text: string, overrides: Partial<ProcedureMaterial['source']> = {}): ProcedureMaterial => ({
  id, intakeId: 'intake', state: 'pending', procedureId: null, attempts: 1, createdAt: new Date('2026-09-20T00:00:00Z'),
  source: { id: `source-${id}`, text, capturedAt: '2026-09-20T01:00:00.000Z', images: [], ...overrides },
  organized: { title: 't', summary: 's', category: '段取り', quotes: [], photos: [] },
});
const withPhoto = (base: ProcedureMaterial, imageId: string): ProcedureMaterial => ({
  ...base,
  source: { ...base.source, images: [{ id: imageId, originalKey: `knowledge-assets/${imageId}/original`, displayKey: `knowledge-assets/${imageId}/display.jpg` }] },
  organized: { ...base.organized, photos: [{ id: imageId, description: '治具Bの写真' }] },
});
const step = (overrides: Partial<RawStep> = {}): RawStep => ({
  title: '治具を準備する', body: '治具Bを出す。', cautions: [], needsReview: [], photoIds: [], sources: [{ materialId: 'm1' }], ...overrides,
});
const header = { title: '申し込み手順', category: '事務手続き', identifiers: {}, reviewTier: 'auto_publish' as const };

describe('procedure review tier', () => {
  it('publishes automatically only a confident, general topic', () => {
    expect(enforceReviewTier(header, 0.95)).toBe('auto_publish');
    expect(enforceReviewTier(header, 0.5)).toBe('approval_required');
    expect(enforceReviewTier({ ...header, title: '部品Aの段取り' }, 0.99)).toBe('approval_required');
    expect(enforceReviewTier({ ...header, identifiers: { partNumber: 'P-1' } }, 0.99)).toBe('approval_required');
    expect(enforceReviewTier({ ...header, reviewTier: 'approval_required' }, 0.99)).toBe('approval_required');
  });
});

describe('procedure topic assignment', () => {
  const topics = [{ procedureId: 'p1', header }];
  it('accepts only known topics and validates new headers', () => {
    expect(validateAssignment({ action: 'existing', procedureId: 'p1', confidence: 0.9 }, topics)).toEqual({ kind: 'existing', topic: topics[0] });
    expect(() => validateAssignment({ action: 'existing', procedureId: 'invented', confidence: 0.9 }, topics)).toThrow('UNKNOWN_PROCEDURE_TOPIC');
    expect(validateAssignment({ action: 'none', confidence: 0.9 }, topics)).toEqual({ kind: 'none' });
    const created = validateAssignment({ action: 'new', header: { ...header, title: '部品Aの切削' }, confidence: 0.99 }, topics);
    expect(created).toMatchObject({ kind: 'new', header: { reviewTier: 'approval_required' } });
    expect(() => validateAssignment({ action: 'new', header: { title: '' }, confidence: 0.9 }, topics)).toThrow();
  });
});

describe('procedure content from composed steps', () => {
  it('keeps verbatim quotations and drops invented ones', () => {
    const content = buildProcedureContent([material('m1', '治具Bは受け面を拭いてから使う。')], [
      step({ sources: [{ materialId: 'm1', quote: '受け面を拭いてから' }] }),
      step({ title: '二', sources: [{ materialId: 'm1', quote: '存在しない引用' }] }),
    ]);
    expect(content.steps[0]!.sources[0]).toMatchObject({ kind: 'note', ref: 'source-m1', quote: '受け面を拭いてから', label: 'メモ 2026/09/20' });
    expect(content.steps[1]!.sources[0]!.quote).toBeUndefined();
  });

  it('drops steps without a known source and photos of uncited materials', () => {
    const m1 = withPhoto(material('m1', 'メモ'), photo);
    const m2 = withPhoto(material('m2', 'メモ2'), otherPhoto);
    const content = buildProcedureContent([m1, m2], [
      step({ sources: [{ materialId: 'invented' }] }),
      step({ title: '写真付き', photoIds: [photo, otherPhoto, 'c'.repeat(64)], sources: [{ materialId: 'm1' }, { materialId: 'm1' }] }),
    ]);
    expect(content.steps).toHaveLength(1);
    expect(content.steps[0]).toMatchObject({ id: 's1', title: '写真付き', photos: [{ imageId: photo, caption: '治具Bの写真' }] });
    expect(content.steps[0]!.sources).toHaveLength(1);
  });

  it('labels PDF pages and photo-only notes from trusted metadata', () => {
    const page = material('m1', '要点', { pdf: { assetId: 'd'.repeat(64), filename: '要領書.pdf', pageNumber: 5, extraction: 'embedded' } });
    const photoOnly = withPhoto(material('m2', '（写真のみ）'), photo);
    const content = buildProcedureContent([page, photoOnly], [step({ sources: [{ materialId: 'm1' }, { materialId: 'm2' }] })]);
    expect(content.steps[0]!.sources.map(source => [source.kind, source.label])).toEqual([
      ['pdf_page', 'PDF「要領書.pdf」5ページ'], ['photo', '写真 2026/09/20'],
    ]);
  });

  it('refuses to create an empty procedure', () => {
    expect(() => buildProcedureContent([material('m1', 'x')], [step({ sources: [] })])).toThrow('NO_SUPPORTED_STEPS');
  });
});
