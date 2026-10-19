import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import type { PdfPagesPort } from '../knowledge/pdf-pages.port.js';
import { PdfPageCountError, PopplerPdfPagesAdapter } from '../knowledge/poppler-pdf-pages.adapter.js';

export const PROCEDURE_MATERIAL_MAX_PDF_PAGES = 25;
export const PROCEDURE_MATERIAL_PDF_PAGE_TEXT_LIMIT = 4000;
export const PROCEDURE_MATERIAL_PDF_TEXT_LIMIT = 20000;

export function normalizeProcedureMaterialPdfText(text: string, limit = PROCEDURE_MATERIAL_PDF_PAGE_TEXT_LIMIT): string | null {
  const clean = text.replaceAll('\0', '').replace(/[\uD800-\uDFFF]/gu, '').trim();
  return Array.from(clean).slice(0, limit).join('') || null;
}

export function joinProcedureMaterialPdfText(pages: Array<{ pageNumber: number; text: string | null }>): string | null {
  return normalizeProcedureMaterialPdfText([...pages].sort((a, b) => a.pageNumber - b.pageNumber).map((page) => page.text ?? '').join('\n'), PROCEDURE_MATERIAL_PDF_TEXT_LIMIT);
}

export class ProcedureMaterialPdfTextService {
  constructor(
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
    private readonly pdfPages: PdfPagesPort = new PopplerPdfPagesAdapter({ maxPages: PROCEDURE_MATERIAL_MAX_PDF_PAGES }),
  ) {}

  async backfill(options: { dryRun?: boolean; limit?: number } = {}) {
    const dryRun = options.dryRun ?? true;
    const candidates = await this.db.procedureMaterial.findMany({
      where: { kind: 'PDF', text: null, discardedAt: null, storageKey: { not: null } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: options.limit ?? 50,
      select: { id: true, storageKey: true, gmailDedupeKey: true },
    });
    const result = { dryRun, candidates: candidates.length, updated: 0, withoutText: 0, failed: 0 };
    for (const candidate of candidates) {
      try {
        const bytes = await this.store.read(candidate.storageKey!, { verifyIntegrity: true });
        const pages: Array<{ pageNumber: number; text: string | null }> = [];
        for await (const page of this.pdfPages.extract(bytes)) {
          if (pages.length >= PROCEDURE_MATERIAL_MAX_PDF_PAGES) throw new PdfPageCountError(pages.length + 1, PROCEDURE_MATERIAL_MAX_PDF_PAGES);
          pages.push({ pageNumber: page.pageNumber, text: normalizeProcedureMaterialPdfText(page.text) });
        }
        if (!pages.length) throw new Error('PDF にページがありません');
        const text = joinProcedureMaterialPdfText(pages);
        if (dryRun) { if (!text) result.withoutText++; continue; }
        const updated = await this.db.$transaction(async (tx) => {
          const pdf = await tx.procedureMaterial.updateMany({
            where: { id: candidate.id, kind: 'PDF', text: null, discardedAt: null, storageKey: candidate.storageKey },
            // Empty text marks a scan as examined without changing its display.
            data: { text: text ?? '' },
          });
          if (!pdf.count) return false;
          for (const page of pages) {
            if (!page.text) continue;
            await tx.procedureMaterial.updateMany({
              where: { kind: 'PHOTO', gmailDedupeKey: `${candidate.gmailDedupeKey}:p${page.pageNumber}`, text: null, discardedAt: null },
              data: { text: page.text },
            });
          }
          return true;
        });
        if (updated) { if (text) result.updated++; else result.withoutText++; }
      } catch { result.failed++; }
    }
    return result;
  }
}
