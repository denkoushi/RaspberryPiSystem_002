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
});
