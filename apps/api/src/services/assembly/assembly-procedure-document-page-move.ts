import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { hasProcedurePageTemplateReferences } from './assembly-procedure-document-page-references.js';

export async function moveProcedurePageRows(tx: Prisma.TransactionClient, documentId: string, from: number, to: number): Promise<boolean> {
  const pages = await tx.assemblyProcedureDocumentPage.findMany({ where: { documentId }, orderBy: { pageIndex: 'asc' } });
  if (![from, to].every(index => pages.some(page => page.pageIndex === index))) {
    throw new ApiError(400, '並べ替えるページが存在しません');
  }
  if (from === to) return false;
  const range = { gte: Math.min(from, to), lte: Math.max(from, to) };
  if (await hasProcedurePageTemplateReferences(tx, documentId, range)) {
    throw new ApiError(409, 'このページまたは間のページがテンプレートで使われているため、並べ替えられません');
  }

  // Cascaded overlay indexes must be nonnegative. Also account for historical
  // feedback rows that can outlive their page when choosing a free index.
  const [links, captions, text] = await Promise.all([
    tx.procedureVideoLink.aggregate({ where: { assemblyProcedureDocumentId: documentId }, _max: { pageIndex: true } }),
    tx.assemblyProcedureCaptionFeedback.aggregate({ where: { documentId }, _max: { pageIndex: true } }),
    tx.assemblyProcedureTextFeedback.aggregate({ where: { documentId }, _max: { pageIndex: true } })
  ]);
  const temporary = Math.max(pages[pages.length - 1].pageIndex, links._max.pageIndex ?? 0, captions._max.pageIndex ?? 0, text._max.pageIndex ?? 0) + 1;
  const setPageIndex = async (pageIndex: number, nextIndex: number) => {
    const where = { documentId, pageIndex };
    const data = { pageIndex: nextIndex };
    // The composite FK cascades the index to the page's overlays.
    await tx.assemblyProcedureDocumentPage.update({ where: { documentId_pageIndex: where }, data });
    await tx.procedureVideoLink.updateMany({ where: { assemblyProcedureDocumentId: documentId, pageIndex }, data });
    await tx.assemblyProcedureCaptionFeedback.updateMany({ where, data });
    await tx.assemblyProcedureTextFeedback.updateMany({ where, data });
  };

  // Vacate the source slot, then shift each page into the slot just vacated.
  await setPageIndex(from, temporary);
  const step = from < to ? 1 : -1;
  const shifted = pages.filter(page => page.pageIndex >= range.gte && page.pageIndex <= range.lte && page.pageIndex !== from);
  if (step < 0) shifted.reverse();
  let vacant = from;
  for (const page of shifted) {
    await setPageIndex(page.pageIndex, vacant);
    vacant = page.pageIndex;
  }
  await setPageIndex(temporary, to);

  if (from === pages[0].pageIndex || to === pages[0].pageIndex) {
    const firstPage = from === pages[0].pageIndex ? pages[1] : pages.find(page => page.pageIndex === from)!;
    await tx.assemblyProcedureDocument.update({ where: { id: documentId }, data: { imageRelativePath: firstPage.imageRelativePath } });
  }
  return true;
}
