import { describe, expect, it, vi } from 'vitest';

import type { GmailMessage, GmailMessagePart } from '../../backup/gmail-api-client.js';
import type { AssemblyProcedureDocumentRecord } from '../assembly-procedure-document.service.js';
import {
  ASSEMBLY_PROCEDURE_GMAIL_QUERY,
  AssemblyProcedureGmailImportService,
  deriveAssemblyProcedureNameFromAttachment,
  hasExactAssemblyProcedureGmailSubject,
  resolveAssemblyProcedureAttachmentKind,
  selectSingleAssemblyProcedureAttachment,
  type AssemblyProcedureDraftWriter,
  type AssemblyProcedureMailGateway
} from '../assembly-procedure-gmail-import.service.js';

const PDF = Buffer.from('%PDF-1.4\n%%EOF', 'ascii');

function makeMessage(params: {
  id: string;
  internalDateMs: number;
  subject?: string;
  filename?: string;
  mimeType?: string;
  parts?: GmailMessagePart[];
}): GmailMessage {
  return {
    id: params.id,
    threadId: `thread-${params.id}`,
    labelIds: ['INBOX', 'UNREAD'],
    snippet: '',
    internalDateMs: params.internalDateMs,
    payload: {
      headers: [{ name: 'Subject', value: params.subject ?? 'DocumentASM' }],
      parts:
        params.parts ??
        [
          {
            mimeType: params.mimeType ?? 'application/pdf',
            filename: params.filename ?? `${params.id}.pdf`,
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            body: { attachmentId: `attachment-${params.id}`, size: PDF.length }
          }
        ]
    }
  };
}

function fakeDocument(id: string, name: string): AssemblyProcedureDocumentRecord {
  return {
    id,
    name,
    imageRelativePath: `/api/storage/assembly-procedure-images/${id}.jpg`,
    status: 'DRAFT',
    sourceType: 'GMAIL',
    gmailMessageId: id,
    sourceAttachmentName: `${name}.pdf`,
    gmailInternalDateMs: 1n,
    gmailDedupeKey: `dedupe-${id}`,
    publishedAt: null,
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    pages: [
      {
        id: `page-${id}`,
        documentId: id,
        pageIndex: 0,
        imageRelativePath: `/api/storage/assembly-procedure-images/${id}.jpg`,
        createdAt: new Date(0)
      }
    ]
  };
}

function createHarness(messages: GmailMessage[]) {
  const messageMap = new Map(messages.map((message) => [message.id, message]));
  const trashed: string[] = [];
  const writes: Array<Parameters<AssemblyProcedureDraftWriter['writeGmailDraft']>[0]> = [];
  const gateway: AssemblyProcedureMailGateway = {
    searchMessagesAll: vi.fn(async () => messages.map((message) => message.id)),
    getMessage: vi.fn(async (messageId) => messageMap.get(messageId)!),
    getAttachment: vi.fn(async () => PDF),
    trashMessage: vi.fn(async (messageId) => {
      trashed.push(messageId);
    })
  };
  const writer: AssemblyProcedureDraftWriter = {
    writeGmailDraft: vi.fn(async (params) => {
      writes.push(params);
      return { status: 'created', document: fakeDocument(params.gmailMessageId, params.name) };
    })
  };
  const service = new AssemblyProcedureGmailImportService({
    createMailGateway: async () => gateway,
    draftWriter: writer
  });
  return { service, gateway, writer, writes, trashed };
}

describe('assembly procedure Gmail helpers', () => {
  it('requires an exact case-sensitive subject after trim', () => {
    expect(hasExactAssemblyProcedureGmailSubject(makeMessage({ id: 'a', internalDateMs: 1 }))).toBe(true);
    expect(
      hasExactAssemblyProcedureGmailSubject(
        makeMessage({ id: 'b', internalDateMs: 1, subject: ' DocumentASM ' })
      )
    ).toBe(true);
    expect(
      hasExactAssemblyProcedureGmailSubject(
        makeMessage({ id: 'c', internalDateMs: 1, subject: 'documentasm' })
      )
    ).toBe(false);
    expect(
      hasExactAssemblyProcedureGmailSubject(
        makeMessage({ id: 'd', internalDateMs: 1, subject: 'DocumentASM 工程A' })
      )
    ).toBe(false);
  });

  it('ignores inline signature images and selects the one real attachment', () => {
    const selected = selectSingleAssemblyProcedureAttachment(
      makeMessage({
        id: 'inline',
        internalDateMs: 1,
        parts: [
          {
            mimeType: 'image/jpeg',
            filename: 'signature.jpg',
            headers: [{ name: 'Content-Disposition', value: 'inline' }],
            body: { attachmentId: 'signature' }
          },
          {
            mimeType: 'application/pdf',
            filename: '工程A.pdf',
            headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            body: { attachmentId: 'procedure' }
          }
        ]
      })
    );
    expect(selected.filename).toBe('工程A.pdf');
  });

  it('rejects multiple real attachments', () => {
    const message = makeMessage({
      id: 'multiple',
      internalDateMs: 1,
      parts: [
        {
          mimeType: 'application/pdf',
          filename: 'a.pdf',
          body: { attachmentId: 'a' }
        },
        {
          mimeType: 'image/jpeg',
          filename: 'b.jpg',
          body: { attachmentId: 'b' }
        }
      ]
    });
    expect(() => selectSingleAssemblyProcedureAttachment(message)).toThrow(
      '添付ファイルは1つだけにしてください'
    );
  });

  it('validates extension/MIME and derives an NFC basename without extension', () => {
    expect(resolveAssemblyProcedureAttachmentKind({ filename: 'a.PDF', mimeType: 'application/pdf' })).toBe('pdf');
    expect(resolveAssemblyProcedureAttachmentKind({ filename: 'a.jpeg', mimeType: 'image/jpeg' })).toBe('jpeg');
    expect(() =>
      resolveAssemblyProcedureAttachmentKind({ filename: 'a.pdf', mimeType: 'image/jpeg' })
    ).toThrow('一致しません');
    expect(deriveAssemblyProcedureNameFromAttachment('../工程Ａ.JPEG')).toBe('工程Ａ');
  });
});

describe('AssemblyProcedureGmailImportService', () => {
  it('processes exact-subject messages oldest first and caps each request at ten', async () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      makeMessage({
        id: `message-${index + 1}`,
        internalDateMs: 12 - index,
        filename: `工程${index + 1}.pdf`
      })
    );
    const harness = createHarness(messages);

    const result = await harness.service.ingest();

    expect(harness.gateway.searchMessagesAll).toHaveBeenCalledWith(ASSEMBLY_PROCEDURE_GMAIL_QUERY);
    expect(harness.writes.map((write) => write.gmailInternalDateMs)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    ]);
    expect(result).toMatchObject({
      scanned: 12,
      exactMatched: 12,
      attempted: 10,
      imported: 10,
      duplicates: 0,
      trashed: 10,
      failed: 0,
      remainingInInbox: 2
    });
  });

  it('leaves an invalid message in the inbox and continues with later messages', async () => {
    const invalid = makeMessage({ id: 'invalid', internalDateMs: 1, parts: [] });
    const valid = makeMessage({ id: 'valid', internalDateMs: 2 });
    const harness = createHarness([invalid, valid]);

    const result = await harness.service.ingest();

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.remainingInInbox).toBe(1);
    expect(harness.trashed).toEqual(['valid']);
    expect(result.items[0]).toMatchObject({ messageId: 'invalid', status: 'import_failed' });
  });

  it('reports a duplicate and still moves its message to trash', async () => {
    const harness = createHarness([makeMessage({ id: 'duplicate', internalDateMs: 1 })]);
    vi.mocked(harness.writer.writeGmailDraft).mockResolvedValueOnce({
      status: 'duplicate',
      document: fakeDocument('existing', 'duplicate')
    });

    const result = await harness.service.ingest();
    expect(result).toMatchObject({ imported: 0, duplicates: 1, trashed: 1, failed: 0 });
    expect(result.items[0]?.status).toBe('duplicate');
  });

  it('reports cleanup failure after a durable document and retries safely on the next call', async () => {
    const harness = createHarness([makeMessage({ id: 'cleanup', internalDateMs: 1 })]);
    vi.mocked(harness.gateway.trashMessage)
      .mockRejectedValueOnce(new Error('scope denied'))
      .mockResolvedValueOnce();

    const first = await harness.service.ingest();
    expect(first.items[0]).toMatchObject({ status: 'cleanup_failed' });
    expect(first.remainingInInbox).toBe(1);

    vi.mocked(harness.writer.writeGmailDraft).mockResolvedValueOnce({
      status: 'duplicate',
      document: fakeDocument('existing-cleanup', 'cleanup')
    });
    const second = await harness.service.ingest();
    expect(second).toMatchObject({ duplicates: 1, trashed: 1, failed: 0, remainingInInbox: 0 });
  });

  it('rejects a concurrent request without waiting', async () => {
    let releaseSearch!: (ids: string[]) => void;
    const search = new Promise<string[]>((resolve) => {
      releaseSearch = resolve;
    });
    const harness = createHarness([]);
    vi.mocked(harness.gateway.searchMessagesAll).mockReturnValueOnce(search);

    const first = harness.service.ingest();
    await Promise.resolve();
    await expect(harness.service.ingest()).rejects.toMatchObject({
      statusCode: 409,
      code: 'ASSEMBLY_PROCEDURE_GMAIL_IMPORT_RUNNING'
    });
    releaseSearch([]);
    await first;
  });

  it('maps Gmail search failures to a stable API error', async () => {
    const harness = createHarness([]);
    vi.mocked(harness.gateway.searchMessagesAll).mockRejectedValueOnce(new Error('upstream unavailable'));

    await expect(harness.service.ingest()).rejects.toMatchObject({
      statusCode: 502,
      code: 'ASSEMBLY_PROCEDURE_GMAIL_SEARCH_FAILED'
    });
  });
});
