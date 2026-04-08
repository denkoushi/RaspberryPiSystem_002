import { describe, expect, it, vi } from 'vitest';

import { KioskDocumentService } from '../kiosk-document.service.js';
import type { KioskDocumentRepositoryPort } from '../ports/kiosk-document-repository.port.js';
import type { PdfFileStorePort } from '../ports/pdf-file-store.port.js';
import type { PdfRenderPort } from '../ports/pdf-render.port.js';
import type { HtmlToPdfPort } from '../ports/html-to-pdf.port.js';

describe('KioskDocumentService HTML Gmail path', () => {
  it('throws when htmlToPdf is not configured', async () => {
    const repo = {} as KioskDocumentRepositoryPort;
    const fileStore = {} as PdfFileStorePort;
    const render = {} as PdfRenderPort;
    const svc = new KioskDocumentService(repo, fileStore, render);
    await expect(
      svc.createFromGmailHtmlAttachment({
        htmlBuffer: Buffer.from('<html><body>x</body></html>'),
        attachmentFilename: 'a.html',
        gmailMessageId: 'm1',
        gmailInternalDateMs: 1,
      })
    ).rejects.toMatchObject({ code: 'KIOSK_DOC_HTML_TO_PDF_NOT_CONFIGURED' });
  });

  it('converts HTML via port and persists PDF metadata', async () => {
    const findByGmailDedupeKey = vi.fn().mockResolvedValue(null);
    const findByGmailLogicalKey = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({
      id: 'doc-1',
      title: 'x',
      filePath: '/tmp/x.pdf',
    });
    const update = vi.fn().mockImplementation((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ id, ...data })
    );
    const repo = { findByGmailDedupeKey, findByGmailLogicalKey, create, update } as unknown as KioskDocumentRepositoryPort;

    const savePdf = vi.fn().mockResolvedValue({
      filename: 'stored.pdf',
      filePath: '/pdfs/stored.pdf',
    });
    const deletePdfByStorageUrl = vi.fn().mockResolvedValue(undefined);
    const fileStore = { savePdf, deletePdfByStorageUrl } as unknown as PdfFileStorePort;

    const convertPdfToPageUrls = vi.fn().mockResolvedValue(['/p1']);
    const deletePageImages = vi.fn().mockResolvedValue(undefined);
    const render = { convertPdfToPageUrls, deletePageImages } as unknown as PdfRenderPort;

    const htmlToPdf: HtmlToPdfPort = {
      convert: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
    };

    const svc = new KioskDocumentService(repo, fileStore, render, htmlToPdf);
    const result = await svc.createFromGmailHtmlAttachment({
      htmlBuffer: Buffer.from('<html><body>Hi</body></html>'),
      attachmentFilename: 'note.html',
      gmailMessageId: 'mid-99',
      gmailInternalDateMs: 1700000000000,
    });

    expect(result.status).toBe('imported');
    expect(result.mode).toBe('created');
    expect(htmlToPdf.convert).toHaveBeenCalledWith('<html><body>Hi</body></html>');
    expect(savePdf).toHaveBeenCalledWith('note.pdf', expect.any(Buffer));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAttachmentName: 'note.html',
        gmailMessageId: 'mid-99',
        sourceType: 'GMAIL',
        gmailLogicalKey: 'note.html',
      })
    );
    expect(convertPdfToPageUrls).toHaveBeenCalledWith('doc-1', '/pdfs/stored.pdf');
    expect(result.detail.pageUrls).toEqual(['/p1']);
  });
});
