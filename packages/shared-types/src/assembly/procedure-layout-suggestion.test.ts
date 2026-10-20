import { describe, expect, it } from 'vitest';

import { procedureLayoutSuggestionRequestSchema, procedureLayoutSuggestionResponseSchema } from './procedure-layout-suggestion.js';

const elements = [
  { id: 'text', kind: 'TEXT', text: '  1 手順\n', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.1 } },
  { id: 'photo', kind: 'IMAGE', assetId: 'asset', pageIndex: 0, zIndex: 1, bbox: { xRatio: 0.1, yRatio: 0.3, widthRatio: 0.3, heightRatio: 0.2 } }
];

describe('procedure layout suggestion contracts', () => {
  it('preserves exact draft text after validating the overlay contract', () => {
    const request = procedureLayoutSuggestionRequestSchema.parse({ pageIndex: 0, elements });
    expect(request.elements[0]).toMatchObject({ text: '  1 手順\n' });
    const response = procedureLayoutSuggestionResponseSchema.parse({ elements, addedElementIds: [], changes: ['文章をそろえた'] });
    expect(response.elements[0]).toMatchObject({ text: '  1 手順\n' });
  });
  it.each([
    { pageIndex: 1, elements },
    { pageIndex: 0, elements: [elements[0]] },
    { pageIndex: 0, elements: [elements[0], elements[0]] },
    { pageIndex: 0, elements: elements.map((element) => ({ ...element, id: undefined })) },
    { pageIndex: 0, elements: elements.map((element) => ({ ...element, bbox: { ...element.bbox, xRatio: 0.9 } })) }
  ])('rejects other pages, insufficient elements, duplicate/missing IDs and overflow (%j)', (request) => {
    expect(procedureLayoutSuggestionRequestSchema.safeParse(request).success).toBe(false);
  });
  it('requires one complete suggestion with at most eight changes', () => {
    const response = { elements, addedElementIds: ['text'], changes: ['文章を足した'] };
    expect(procedureLayoutSuggestionResponseSchema.safeParse(response).success).toBe(true);
    for (const invalid of [
      { plans: [] }, { ...response, changes: Array(9).fill('変更') },
      { ...response, addedElementIds: ['photo'] }, { ...response, addedElementIds: ['unknown'] },
      { ...response, addedElementIds: ['text', 'text'] }, { ...response, changes: [] }
    ]) expect(procedureLayoutSuggestionResponseSchema.safeParse(invalid).success).toBe(false);
  });
  it('validates added captions within every overflow alternative instead of the original elements', () => {
    const added = { ...elements[0], id: 'added' };
    const response = { elements, addedElementIds: ['added'], changes: ['写真が1ページに入りきりません'], overflow: {
      shrink: { elements: [...elements, added], changes: ['写真を縮めた'], scalePercent: 88 },
      split: { elements: [elements[0]], nextPageElements: [elements[1], added].map(element => ({ ...element, pageIndex: 1 })), changes: ['2ページに分けた'], firstMovedPhotoNumber: 2 }
    } };
    expect(procedureLayoutSuggestionResponseSchema.safeParse(response).success).toBe(true);
    expect(procedureLayoutSuggestionResponseSchema.safeParse({ ...response, overflow: {} }).success).toBe(false);
    expect(procedureLayoutSuggestionResponseSchema.safeParse({ ...response, overflow: { shrink: { ...response.overflow.shrink, elements } } }).success).toBe(false);
    expect(procedureLayoutSuggestionResponseSchema.safeParse({ ...response, overflow: { shrink: { ...response.overflow.shrink, scalePercent: 49 } } }).success).toBe(false);
  });
});
