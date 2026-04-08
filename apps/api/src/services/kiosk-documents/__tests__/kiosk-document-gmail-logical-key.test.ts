import { describe, expect, it } from 'vitest';

import { normalizeKioskGmailLogicalKey } from '../kiosk-document-gmail-logical-key.js';

describe('normalizeKioskGmailLogicalKey', () => {
  it('trims, NFC-lowercases path separators', () => {
    expect(normalizeKioskGmailLogicalKey('  Foo\\Bar.HTML  ')).toBe('foo/bar.html');
  });

  it('returns empty for blank', () => {
    expect(normalizeKioskGmailLogicalKey('  ')).toBe('');
  });
});
