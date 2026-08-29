import { describe, expect, it, vi } from 'vitest';

import {
  buildKioskDocumentGmailSearchQuery,
  findEligibleKioskMessages,
} from '../kiosk-document-gmail-ingestion.service.js';
import { buildGmailDedupeKey, deriveStoragePdfFilenameFromHtmlAttachment } from '../kiosk-document.service.js';

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

describe('findEligibleKioskMessages', () => {
  it('fills the kiosk batch beyond leading work-instruction messages', async () => {
    const ownedIds = Array.from({ length: 25 }, (_, index) => `owned-${index}`);
    const validId = 'kiosk-valid';
    const getMessage = vi.fn(async (messageId: string) => ({
      id: messageId,
      threadId: messageId,
      labelIds: ['UNREAD'],
      snippet: '',
      internalDateMs: 1,
      payload: {
        headers: [{
          name: 'Subject',
          value: messageId === validId ? 'DocumentASM' : '[WORK-INSTRUCTION] row',
        }],
      },
    }));
    const searchMessagesAll = vi.fn(async () => [...ownedIds, validId]);

    const selected = await findEligibleKioskMessages(
      { getMessage, searchMessagesAll },
      'subject:"DocumentASM" is:unread',
      ownedIds
    );

    expect(selected.ids).toEqual([validId]);
    expect(selected.scanned).toBe(26);
    expect(searchMessagesAll).toHaveBeenCalledTimes(1);
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

describe('deriveStoragePdfFilenameFromHtmlAttachment', () => {
  it('replaces .html with .pdf', () => {
    expect(deriveStoragePdfFilenameFromHtmlAttachment('SD000032603_研削_OP-01.html')).toBe(
      'SD000032603_研削_OP-01.pdf'
    );
  });

  it('replaces .htm with .pdf', () => {
    expect(deriveStoragePdfFilenameFromHtmlAttachment('doc.htm')).toBe('doc.pdf');
  });

  it('appends .pdf when no html extension', () => {
    expect(deriveStoragePdfFilenameFromHtmlAttachment('unnamed')).toBe('unnamed.pdf');
  });
});
