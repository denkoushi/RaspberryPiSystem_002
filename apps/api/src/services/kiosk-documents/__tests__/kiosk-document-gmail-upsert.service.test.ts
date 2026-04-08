import { describe, expect, it, vi } from 'vitest';

import { KioskDocumentService } from '../kiosk-document.service.js';
import type { KioskDocumentRepositoryPort } from '../ports/kiosk-document-repository.port.js';
import type { PdfFileStorePort } from '../ports/pdf-file-store.port.js';
import type { PdfRenderPort } from '../ports/pdf-render.port.js';

describe('KioskDocumentService Gmail PDF upsert', () => {
  it('skips when same mail+attachment already imported (gmailDedupeKey)', async () => {
    const findByGmailDedupeKey = vi.fn().mockResolvedValue({ id: 'existing' });
    const findByGmailLogicalKey = vi.fn();
    const repo = { findByGmailDedupeKey, findByGmailLogicalKey } as unknown as KioskDocumentRepositoryPort;
    const svc = new KioskDocumentService(
      repo,
      {} as PdfFileStorePort,
      {} as PdfRenderPort
    );
    const result = await svc.createFromGmailAttachment({
      buffer: Buffer.from('%PDF'),
      attachmentFilename: 'a.pdf',
      gmailMessageId: 'mid',
      gmailInternalDateMs: 2000,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'duplicate_same_mail' });
    expect(findByGmailLogicalKey).not.toHaveBeenCalled();
  });

  it('skips when stored mail is newer than incoming', async () => {
    const findByGmailDedupeKey = vi.fn().mockResolvedValue(null);
    const findByGmailLogicalKey = vi.fn().mockResolvedValue({
      id: 'doc-old',
      gmailInternalDateMs: BigInt(3000),
      filePath: '/old/x.pdf',
    });
    const repo = { findByGmailDedupeKey, findByGmailLogicalKey } as unknown as KioskDocumentRepositoryPort;
    const svc = new KioskDocumentService(
      repo,
      {} as PdfFileStorePort,
      {} as PdfRenderPort
    );
    const result = await svc.createFromGmailAttachment({
      buffer: Buffer.from('%PDF'),
      attachmentFilename: 'Same.PDF',
      gmailMessageId: 'mid-new',
      gmailInternalDateMs: 2000,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'older_mail' });
  });

  it('updates existing row when incoming internalDate is newer', async () => {
    const findByGmailDedupeKey = vi.fn().mockResolvedValue(null);
    const findByGmailLogicalKey = vi.fn().mockResolvedValue({
      id: 'doc-1',
      gmailInternalDateMs: BigInt(1000),
      filePath: '/storage/old.pdf',
    });
    const update = vi.fn().mockImplementation((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ id, ...data })
    );
    const repo = {
      findByGmailDedupeKey,
      findByGmailLogicalKey,
      create: vi.fn(),
      update,
    } as unknown as KioskDocumentRepositoryPort;

    const savePdf = vi.fn().mockResolvedValue({ filename: 'n.pdf', filePath: '/storage/new.pdf' });
    const deletePdfByStorageUrl = vi.fn().mockResolvedValue(undefined);
    const fileStore = { savePdf, deletePdfByStorageUrl } as unknown as PdfFileStorePort;

    const deletePageImages = vi.fn().mockResolvedValue(undefined);
    const convertPdfToPageUrls = vi.fn().mockResolvedValue(['/u1']);
    const render = { deletePageImages, convertPdfToPageUrls } as unknown as PdfRenderPort;

    const svc = new KioskDocumentService(repo, fileStore, render);
    const result = await svc.createFromGmailAttachment({
      buffer: Buffer.from('%PDF-1.4'),
      attachmentFilename: 'Same.PDF',
      gmailMessageId: 'mid-2',
      gmailInternalDateMs: 5000,
    });

    expect(result.status).toBe('imported');
    if (result.status !== 'imported') throw new Error('unexpected');
    expect(result.mode).toBe('updated');
    expect(deletePageImages).toHaveBeenCalledWith('doc-1');
    expect(deletePdfByStorageUrl).toHaveBeenCalledWith('/api/storage/pdfs/old.pdf');
    expect(savePdf).toHaveBeenCalledWith('Same.PDF', expect.any(Buffer));
    expect(update).toHaveBeenCalled();
    expect(convertPdfToPageUrls).toHaveBeenCalledWith('doc-1', '/storage/new.pdf');
  });
});
