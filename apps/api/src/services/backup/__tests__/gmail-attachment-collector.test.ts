import { describe, expect, it } from 'vitest';

import {
  collectGmailAttachments,
  type GmailMessage
} from '../gmail-api-client.js';

function message(payload: GmailMessage['payload']): GmailMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: '',
    internalDateMs: 1,
    payload
  };
}

describe('collectGmailAttachments', () => {
  it('walks arbitrary nested MIME parts and preserves size metadata', () => {
    const result = collectGmailAttachments(
      message({
        parts: [
          {
            mimeType: 'multipart/mixed',
            parts: [
              {
                mimeType: 'multipart/alternative',
                parts: [
                  {
                    mimeType: 'application/pdf',
                    filename: '手順書.pdf',
                    headers: [{ name: 'Content-Disposition', value: 'attachment; filename="手順書.pdf"' }],
                    body: { attachmentId: 'pdf-1', size: 1234 }
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    expect(result).toEqual([
      {
        attachmentId: 'pdf-1',
        filename: '手順書.pdf',
        mimeType: 'application/pdf',
        size: 1234,
        isInline: false
      }
    ]);
  });

  it('marks Content-Disposition inline and Content-ID parts as inline', () => {
    const result = collectGmailAttachments(
      message({
        parts: [
          {
            mimeType: 'image/jpeg',
            filename: 'signature.jpg',
            headers: [{ name: 'Content-Disposition', value: 'inline' }],
            body: { attachmentId: 'inline-1' }
          },
          {
            mimeType: 'image/png',
            filename: 'logo.png',
            headers: [{ name: 'Content-ID', value: '<logo>' }],
            body: { attachmentId: 'inline-2' }
          },
          {
            mimeType: 'image/jpeg',
            filename: 'procedure.jpg',
            headers: [
              { name: 'Content-ID', value: '<procedure>' },
              { name: 'Content-Disposition', value: 'attachment' }
            ],
            body: { attachmentId: 'attached-1' }
          }
        ]
      })
    );

    expect(result.map((item) => item.isInline)).toEqual([true, true, false]);
  });

  it('deduplicates a repeated attachment id and filename', () => {
    const repeated = {
      mimeType: 'application/pdf',
      filename: 'same.pdf',
      body: { attachmentId: 'same-1' }
    };
    const result = collectGmailAttachments(message({ ...repeated, parts: [repeated] }));
    expect(result).toHaveLength(1);
  });

  it('preserves the attachment filename exactly for audit metadata', () => {
    const result = collectGmailAttachments(
      message({
        parts: [
          {
            mimeType: 'application/pdf',
            filename: '  工程A.pdf  ',
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            body: { attachmentId: 'audit-name' }
          }
        ]
      })
    );

    expect(result[0]?.filename).toBe('  工程A.pdf  ');
  });
});
