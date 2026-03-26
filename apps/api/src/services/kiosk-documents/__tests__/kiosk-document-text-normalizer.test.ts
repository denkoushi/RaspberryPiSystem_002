import { describe, expect, it } from 'vitest';

import { normalizeDocumentText } from '../kiosk-document-text-normalizer.js';

describe('normalizeDocumentText', () => {
  it('normalizes width/case/spacing', () => {
    const value = ' ＦＨＩＮＣＤ   AB-123  \n  Test ';
    expect(normalizeDocumentText(value)).toBe('fhincd ab-123 test');
  });
});
