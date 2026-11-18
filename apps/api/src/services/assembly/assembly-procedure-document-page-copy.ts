import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { overlayToCreateDataFromRow } from './assembly-procedure-overlay.persistence.js';
import type { AssemblyProcedureDocumentRevisionRecord } from './assembly-procedure-document-revision.service.js';

type ProcedurePagesToCopy = Pick<AssemblyProcedureDocumentRevisionRecord, 'pages' | 'overlayElements' | 'procedureVideoLinks'>;

export async function copyProcedurePages(
  tx: Prisma.TransactionClient,
  documentId: string,
  source: ProcedurePagesToCopy,
  pageIndexes?: ReadonlyMap<number, number>
) {
  const destinationIndex = (pageIndex: number) => pageIndexes ? pageIndexes.get(pageIndex) : pageIndex;
  const pages = source.pages.flatMap(page => {
    const pageIndex = destinationIndex(page.pageIndex);
    return pageIndex === undefined ? [] : [{ documentId, pageIndex, imageRelativePath: page.imageRelativePath }];
  });
  await tx.assemblyProcedureDocumentPage.createMany({ data: pages });
  const overlays = source.overlayElements.flatMap(overlay => {
    const pageIndex = destinationIndex(overlay.pageIndex);
    return pageIndex === undefined ? [] : [{
      ...overlayToCreateDataFromRow(documentId, overlay),
      pageIndex,
      id: randomUUID()
    }];
  });
  if (overlays.length) await tx.assemblyProcedureOverlayElement.createMany({ data: overlays });
  const links = (source.procedureVideoLinks ?? []).flatMap(link => {
    const pageIndex = destinationIndex(link.pageIndex);
    return pageIndex === undefined ? [] : [{
      assemblyProcedureDocumentId: documentId, pageIndex,
      videoId: link.videoId, sceneId: link.sceneId, sortOrder: link.sortOrder
    }];
  });
  if (links.length) await tx.procedureVideoLink.createMany({ data: links });
}

export async function shiftProcedurePages(
  tx: Prisma.TransactionClient, documentId: string, afterPageIndex: number, count: number, templateConflictMessage: string
) {
  const later = { gt: afterPageIndex };
  const where = { assemblyProcedureDocumentId: documentId, pageIndex: later };
  const references = await Promise.all([
    tx.assemblyTemplateProcedureStep.count({ where }),
    tx.assemblyTemplateBolt.count({ where: afterPageIndex >= 0 ? where : { OR: [
      where,
      { assemblyProcedureDocumentId: documentId, pageIndex: null },
      { assemblyProcedureDocumentId: null, kioskDocumentId: null, area: { template: { procedureDocumentId: documentId } } }
    ] } }),
    tx.assemblyTemplateCheckItem.count({ where: afterPageIndex >= 0 ? where : { OR: [
      where,
      { assemblyProcedureDocumentId: null, kioskDocumentId: null, template: { procedureDocumentId: documentId } }
    ] } })
  ]);
  if (references.some(referenceCount => referenceCount > 0)) {
    throw new ApiError(409, templateConflictMessage);
  }
  // Descending updates avoid unique-index collisions. The page FK moves overlays with their page.
  const pages = await tx.assemblyProcedureDocumentPage.findMany({ where: { documentId, pageIndex: later }, orderBy: { pageIndex: 'desc' } });
  for (const page of pages) {
    await tx.assemblyProcedureDocumentPage.update({ where: { documentId_pageIndex: { documentId, pageIndex: page.pageIndex } }, data: { pageIndex: page.pageIndex + count } });
  }
  const links = await tx.procedureVideoLink.findMany({ where, orderBy: { pageIndex: 'desc' } });
  for (const link of links) {
    await tx.procedureVideoLink.update({ where: { id: link.id }, data: { pageIndex: link.pageIndex + count } });
  }
  const feedbackUpdate = { where: { documentId, pageIndex: later }, data: { pageIndex: { increment: count } } };
  await tx.assemblyProcedureCaptionFeedback.updateMany(feedbackUpdate);
  await tx.assemblyProcedureTextFeedback.updateMany(feedbackUpdate);
}
