import type { Prisma } from '@prisma/client';

export async function hasProcedurePageTemplateReferences(tx: Prisma.TransactionClient, documentId: string, range: { gte: number; lte?: number }) {
  const referencesWhere = { assemblyProcedureDocumentId: documentId, pageIndex: range };
  const references = await Promise.all([
    tx.assemblyTemplateProcedureStep.count({ where: referencesWhere }),
    tx.assemblyTemplateBolt.count({ where: { OR: [
      referencesWhere,
      ...(range.gte === 0 ? [
        { assemblyProcedureDocumentId: documentId, pageIndex: null },
        { assemblyProcedureDocumentId: null, kioskDocumentId: null, area: { template: { procedureDocumentId: documentId } } }
      ] : [])
    ] } }),
    tx.assemblyTemplateCheckItem.count({ where: { OR: [
      referencesWhere,
      ...(range.gte === 0 ? [{ assemblyProcedureDocumentId: null, kioskDocumentId: null, template: { procedureDocumentId: documentId } }] : [])
    ] } })
  ]);
  return references.some(count => count > 0);
}
