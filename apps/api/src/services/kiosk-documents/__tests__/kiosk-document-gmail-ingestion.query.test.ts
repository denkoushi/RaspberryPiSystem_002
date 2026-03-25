import { describe, expect, it } from 'vitest';

import { buildKioskDocumentGmailSearchQuery } from '../kiosk-document-gmail-ingestion.service.js';
import { buildGmailDedupeKey } from '../kiosk-document.service.js';

describe('buildKioskDocumentGmailSearchQuery', () => {
  it('builds subject + unread query', () => {
    expect(buildKioskDocumentGmailSearchQuery('要領書アップロード')).toBe('subject:"要領書アップロード" is:unread');
  });

  it('escapes double quotes in subject', () => {
    expect(buildKioskDocumentGmailSearchQuery('say "hi"')).toBe('subject:"say \\"hi\\"" is:unread');
  });

  it('adds from when provided', () => {
    expect(buildKioskDocumentGmailSearchQuery('Doc', 'robot@example.com')).toBe(
      'subject:"Doc" from:robot@example.com is:unread'
    );
  });
});

describe('buildGmailDedupeKey', () => {
  it('is stable for same inputs', () => {
    const a = buildGmailDedupeKey('msg1', 'a.pdf');
    const b = buildGmailDedupeKey('msg1', 'a.pdf');
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  it('differs when filename changes', () => {
    expect(buildGmailDedupeKey('msg1', 'a.pdf')).not.toBe(buildGmailDedupeKey('msg1', 'b.pdf'));
  });
});
