import { describe, expect, it } from 'vitest';

import { shouldCloneTemplateBeforeSheet } from './sheetClonePolicy';

describe('shouldCloneTemplateBeforeSheet', () => {
  it('is false only for exact_resource', () => {
    expect(shouldCloneTemplateBeforeSheet('exact_resource')).toBe(false);
    expect(shouldCloneTemplateBeforeSheet('two_key_fhincd_resource')).toBe(true);
    expect(shouldCloneTemplateBeforeSheet('one_key_fhinmei')).toBe(true);
  });
});
