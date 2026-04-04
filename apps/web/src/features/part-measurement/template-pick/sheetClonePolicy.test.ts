import { describe, expect, it } from 'vitest';

import { shouldCloneTemplateBeforeSheet } from './sheetClonePolicy';

describe('shouldCloneTemplateBeforeSheet', () => {
  it('is false only for exact_resource', () => {
    expect(shouldCloneTemplateBeforeSheet('exact_resource')).toBe(false);
    expect(shouldCloneTemplateBeforeSheet('same_fhincd_other_resource')).toBe(true);
    expect(shouldCloneTemplateBeforeSheet('fhinmei_similar')).toBe(true);
  });
});
