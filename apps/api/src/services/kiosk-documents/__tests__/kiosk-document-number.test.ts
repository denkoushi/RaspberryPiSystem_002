import { describe, expect, it } from 'vitest';

import {
  extractDocumentNumberCandidate,
  isValidKioskDocumentNumber,
  KIOSK_DOCUMENT_NUMBER_PATTERN,
} from '../kiosk-document-number.js';

describe('kiosk-document-number', () => {
  it('accepts sample ISO-style numbers', () => {
    expect(isValidKioskDocumentNumber('産1-G025AAK')).toBe(true);
    expect(isValidKioskDocumentNumber('産12-G708AMK')).toBe(true);
    expect(KIOSK_DOCUMENT_NUMBER_PATTERN.test('産1-g025aak')).toBe(false);
  });

  it('rejects invalid shapes', () => {
    expect(isValidKioskDocumentNumber('')).toBe(false);
    expect(isValidKioskDocumentNumber('G025AAK')).toBe(false);
    expect(isValidKioskDocumentNumber('産-G025AAK')).toBe(false);
    expect(isValidKioskDocumentNumber('産1G025AAK')).toBe(false);
    expect(isValidKioskDocumentNumber('産1-')).toBe(false);
    expect(isValidKioskDocumentNumber('産1-g025aak')).toBe(false);
  });

  it('extracts first candidate from body text', () => {
    expect(extractDocumentNumberCandidate('文書番号 産1-G025AAK について')).toBe('産1-G025AAK');
    expect(extractDocumentNumberCandidate('no match here')).toBeUndefined();
  });
});
