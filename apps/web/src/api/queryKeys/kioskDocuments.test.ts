import { describe, expect, it } from 'vitest';

import { kioskDocumentsQueryKeys } from './kioskDocuments';

describe('kioskDocumentsQueryKeys', () => {
  it('preserves constant keys and invalidation prefix lengths', () => {
    expect(kioskDocumentsQueryKeys.documentsAll).toEqual(['kiosk-documents']);
    expect(kioskDocumentsQueryKeys.documentAll).toEqual(['kiosk-document']);
  });

  it('preserves documents values, argument order and boundary values', () => {
    expect(kioskDocumentsQueryKeys.documents({ q: 'manual', includeCandidates: false, limit: 10, offset: 0 })).toEqual(['kiosk-documents', { q: 'manual', includeCandidates: false, limit: 10, offset: 0 }]);
    expect(kioskDocumentsQueryKeys.documents()).toEqual(['kiosk-documents', undefined]);
    expect(kioskDocumentsQueryKeys.documents(undefined)).toEqual(['kiosk-documents', undefined]);
    expect(kioskDocumentsQueryKeys.documents({})).toEqual(['kiosk-documents', {}]);
    expect(Reflect.apply(kioskDocumentsQueryKeys.documents, undefined, [null])).toEqual(['kiosk-documents', null]);
  });
});
