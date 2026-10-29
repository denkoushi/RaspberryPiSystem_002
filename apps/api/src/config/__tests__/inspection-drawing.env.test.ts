import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { inspectionDrawingEnvShape } from '../env/inspection-drawing.js';

const schema = z.object(inspectionDrawingEnvShape);
describe('inspection drawing transfer JEV configuration', () => {
  it('defaults OFF with a 20 second timeout', () => {
    expect(schema.parse({})).toEqual({ INSPECTION_DRAWING_TRANSFER_JEV_ENABLED: false, INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS: 20000,
      INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: false, INSPECTION_DRAWING_SIBLING_VISION_ENABLED: true, INSPECTION_DRAWING_SIBLING_CANDIDATE_LIMIT: 8 });
  });
  it('normalizes the flag and parses a bounded timeout', () => {
    expect(schema.parse({ INSPECTION_DRAWING_TRANSFER_JEV_ENABLED: ' TRUE ', INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS: '1000',
      INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: ' TRUE ', INSPECTION_DRAWING_SIBLING_VISION_ENABLED: 'false' }))
      .toEqual({ INSPECTION_DRAWING_TRANSFER_JEV_ENABLED: true, INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS: 1000,
        INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: true, INSPECTION_DRAWING_SIBLING_VISION_ENABLED: false, INSPECTION_DRAWING_SIBLING_CANDIDATE_LIMIT: 8 });
  });
  it.each([0, 999, 60001, 'bad'])('rejects invalid timeout %s', (timeout) => {
    expect(schema.safeParse({ INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS: timeout }).success).toBe(false);
  });
  it('rejects a misspelled flag', () => {
    expect(schema.safeParse({ INSPECTION_DRAWING_TRANSFER_JEV_ENABLED: 'enabled' }).success).toBe(false);
    expect(schema.safeParse({ INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: 'enabled' }).success).toBe(false);
    expect(schema.parse({ INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: ' FALSE ' }).INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED).toBe(false);
  });
});

it.each([1, 30, '12'])('accepts sibling candidate limit %s', (limit) => {
  expect(schema.parse({ INSPECTION_DRAWING_SIBLING_CANDIDATE_LIMIT: limit }).INSPECTION_DRAWING_SIBLING_CANDIDATE_LIMIT).toBe(Number(limit));
});
it.each([0, 31, 1.5, 'bad'])('rejects sibling candidate limit %s', (limit) => {
  expect(schema.safeParse({ INSPECTION_DRAWING_SIBLING_CANDIDATE_LIMIT: limit }).success).toBe(false);
});
