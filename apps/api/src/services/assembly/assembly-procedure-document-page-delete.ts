import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { hasProcedurePageTemplateReferences } from './assembly-procedure-document-page-references.js';
import { resolveProcedureCaptionFeedback } from './procedure-caption-feedback.js';
import { resolveProcedureTextFeedback } from './procedure-text-feedback.js';

/** Deletes one draft page and renumbers the rows that point at later pages. Returns the asset ids of removed image overlays. */
export async function deleteProcedurePageRows(tx: Prisma.TransactionClient, documentId: string, pageIndex: number): Promise<string[]> {
  const pages = await tx.assemblyProcedureDocumentPage.findMany({ where: { documentId }, orderBy: { pageIndex: 'asc' } });
  if (!pages.some(page => page.pageIndex === pageIndex)) throw new ApiError(400, '削除するページが存在しません');
  if (pages.length <= 1) throw new ApiError(409, '最後の1ページは削除できません');
  if (await hasProcedurePageTemplateReferences(tx, documentId, { gte: pageIndex })) {
    throw new ApiError(409, 'このページまたは後ろのページがテンプレートで使われているため、削除できません');
  }
  const where = { documentId, pageIndex: pageIndex };
  const previousImageElements = await tx.assemblyProcedureOverlayElement.findMany({
    where: { ...where, kind: 'IMAGE' }, select: { assetId: true }
  });
  const removedAssetIds = [...new Set(previousImageElements.map(element => element.assetId).filter((assetId): assetId is string => assetId != null))];
  await tx.assemblyProcedureOverlayElement.deleteMany({ where });
  await tx.procedureVideoLink.deleteMany({ where: { assemblyProcedureDocumentId: documentId, pageIndex: pageIndex } });
  // Keep learning records; resolve them the same way as removing the element in saveOverlays.
  const resolvedAt = new Date();
  for (const row of await tx.assemblyProcedureCaptionFeedback.findMany({ where })) {
    const change = resolveProcedureCaptionFeedback(row, undefined, false);
    if (change) await tx.assemblyProcedureCaptionFeedback.update({ where: { id: row.id }, data: { ...change, resolvedAt } });
  }
  const seen = new Set<string>();
  for (const row of await tx.assemblyProcedureTextFeedback.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })) {
    const key = `${row.source}:${row.elementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const change = resolveProcedureTextFeedback(row, undefined);
    if (change) await tx.assemblyProcedureTextFeedback.update({ where: { id: row.id }, data: { ...change, resolvedAt } });
  }
  await tx.assemblyProcedureDocumentPage.delete({ where: { documentId_pageIndex: where } });
  // The composite page FK cascades overlay indexes; do not shift overlays a second time.
  for (const page of pages.filter(page => page.pageIndex > pageIndex)) {
    await tx.assemblyProcedureDocumentPage.update({ where: { documentId_pageIndex: { documentId, pageIndex: page.pageIndex } }, data: { pageIndex: page.pageIndex - 1 } });
  }
  const links = await tx.procedureVideoLink.findMany({ where: { assemblyProcedureDocumentId: documentId, pageIndex: { gt: pageIndex } }, orderBy: { pageIndex: 'asc' } });
  for (const link of links) {
    await tx.procedureVideoLink.update({ where: { id: link.id }, data: { pageIndex: link.pageIndex - 1 } });
  }
  await tx.assemblyProcedureCaptionFeedback.updateMany({ where: { documentId, pageIndex: { gt: pageIndex } }, data: { pageIndex: { decrement: 1 } } });
  await tx.assemblyProcedureTextFeedback.updateMany({ where: { documentId, pageIndex: { gt: pageIndex } }, data: { pageIndex: { decrement: 1 } } });
  if (pageIndex === pages[0].pageIndex) {
    await tx.assemblyProcedureDocument.update({ where: { id: documentId }, data: { imageRelativePath: pages[1].imageRelativePath } });
  }
  return removedAssetIds;
}
