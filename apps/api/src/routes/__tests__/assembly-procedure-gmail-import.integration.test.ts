import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ingestRouteMock } = vi.hoisted(() => ({
  ingestRouteMock: vi.fn()
}));

vi.mock('../../services/assembly/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/assembly/index.js')>();
  return {
    ...actual,
    createAssemblyProcedureGmailImportService: () => ({
      ingest: ingestRouteMock
    })
  };
});

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
process.env.PHOTO_STORAGE_DIR = '/tmp/test-assembly-procedure-gmail-import';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { buildGmailAttachmentDedupeKey } from '../../services/gmail/gmail-attachment-dedupe-key.js';
import { PrismaAssemblyProcedureDraftWriter } from '../../services/assembly/adapters/assembly-procedure-draft-writer.adapter.js';
import { createTestClientDevice } from './helpers.js';

describe('assembly procedure Gmail import API and persistence', () => {
  const messagePrefix = 'documentasm-integration-';
  const clientKey = 'documentasm-gmail-import-client';
  let app: Awaited<ReturnType<typeof buildServer>>;

  async function deleteOwnedDocuments(): Promise<void> {
    const sources = await prisma.assemblyProcedureDocumentSourceRecord.findMany({
      where: { gmailMessageId: { startsWith: messagePrefix } },
      select: { documentId: true }
    });
    await prisma.assemblyProcedureDocument.deleteMany({
      where: { id: { in: sources.map((source) => source.documentId) } }
    });
  }

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    ingestRouteMock.mockReset();
    await deleteOwnedDocuments();
    await prisma.clientDevice.deleteMany({ where: { apiKey: clientKey } });
    await fs.rm(process.env.PHOTO_STORAGE_DIR!, { recursive: true, force: true });
  });

  afterAll(async () => {
    await app.close();
    await deleteOwnedDocuments();
    await prisma.clientDevice.deleteMany({ where: { apiKey: clientKey } });
    await fs.rm(process.env.PHOTO_STORAGE_DIR!, { recursive: true, force: true });
  });

  it('requires assembly write authorization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents/ingest-gmail'
    });
    expect(response.statusCode).toBe(401);
    expect(ingestRouteMock).not.toHaveBeenCalled();
  });

  it('returns the Gmail import summary to an authorized kiosk client', async () => {
    const client = await createTestClientDevice(clientKey);
    ingestRouteMock.mockResolvedValueOnce({
      query: 'in:inbox is:unread subject:"DocumentASM"',
      scanned: 1,
      exactMatched: 1,
      subjectMismatchSkipped: 0,
      attempted: 1,
      imported: 1,
      duplicates: 0,
      trashed: 1,
      failed: 0,
      remainingInInbox: 0,
      items: [
        {
          messageId: 'gmail-message-1',
          filename: '工程A.pdf',
          status: 'imported',
          document: null,
          error: null
        }
      ]
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/assembly/procedure-documents/ingest-gmail',
      headers: { 'x-client-key': client.apiKey }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      imported: 1,
      trashed: 1,
      remainingInInbox: 0,
      items: [{ filename: '工程A.pdf', status: 'imported' }]
    });
  });

  it('persists Gmail source metadata, remains draft, and deduplicates only the same message', async () => {
    const writer = new PrismaAssemblyProcedureDraftWriter();
    const jpeg = await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .jpeg()
      .toBuffer();
    const filename = '組立工程A.jpg';
    const messageId = `${messagePrefix}${randomUUID()}`;
    const gmailDedupeKey = buildGmailAttachmentDedupeKey(messageId, filename);

    const first = await writer.writeGmailDraft({
      name: '組立工程A',
      buffer: jpeg,
      mimetype: 'image/jpeg',
      filename,
      gmailMessageId: messageId,
      gmailInternalDateMs: 1_784_880_000_000,
      gmailDedupeKey
    });
    expect(first.status).toBe('created');

    const stored = await prisma.assemblyProcedureDocument.findUniqueOrThrow({
      where: { id: first.document.id },
      include: { pages: true, source: true }
    });
    expect(stored).toMatchObject({
      name: '組立工程A',
      status: 'DRAFT',
      source: {
        sourceType: 'GMAIL',
        gmailMessageId: messageId,
        sourceAttachmentName: filename,
        gmailDedupeKey
      }
    });
    expect(stored.source?.gmailInternalDateMs).toBe(1_784_880_000_000n);
    expect(stored.pages).toHaveLength(1);

    const retry = await writer.writeGmailDraft({
      name: '組立工程A',
      buffer: jpeg,
      mimetype: 'image/jpeg',
      filename,
      gmailMessageId: messageId,
      gmailInternalDateMs: 1_784_880_000_000,
      gmailDedupeKey
    });
    expect(retry).toMatchObject({ status: 'duplicate', document: { id: first.document.id } });

    const nextMessageId = `${messagePrefix}${randomUUID()}`;
    const sameFilenameNewMail = await writer.writeGmailDraft({
      name: '組立工程A',
      buffer: jpeg,
      mimetype: 'image/jpeg',
      filename,
      gmailMessageId: nextMessageId,
      gmailInternalDateMs: 1_784_880_001_000,
      gmailDedupeKey: buildGmailAttachmentDedupeKey(nextMessageId, filename)
    });
    expect(sameFilenameNewMail.status).toBe('created');
    expect(sameFilenameNewMail.document.id).not.toBe(first.document.id);
    expect(await prisma.assemblyProcedureDocument.count({ where: { name: '組立工程A' } })).toBe(2);
  });
});
