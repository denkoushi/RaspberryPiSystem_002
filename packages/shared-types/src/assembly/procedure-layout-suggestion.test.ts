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
    const response = procedureLayoutSuggestionResponseSchema.parse({ plans: [{ key: 'standard', elements }, { key: 'largePhoto', elements }] });
    expect(response.plans[0].elements[0]).toMatchObject({ text: '  1 手順\n' });
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
  it('requires exactly the two named plans in the shared response', () => {
    const first = { key: 'standard', elements };
    expect(procedureLayoutSuggestionResponseSchema.safeParse({ plans: [first] }).success).toBe(false);
    expect(procedureLayoutSuggestionResponseSchema.safeParse({ plans: [first, first] }).success).toBe(false);
    expect(procedureLayoutSuggestionResponseSchema.safeParse({ plans: [first, { key: 'largePhoto', elements }, first] }).success).toBe(false);
  });
});
