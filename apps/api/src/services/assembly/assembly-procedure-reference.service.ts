import { prisma } from '../../lib/prisma.js';

export class AssemblyProcedureReferenceService {
  async countKioskDocumentReferences(kioskDocumentId: string): Promise<number> {
    const [legacySequenceCount, templateSequenceCount] = await Promise.all([
      prisma.assemblyProcedureOrderItem.count({ where: { kioskDocumentId } }),
      prisma.assemblyTemplateProcedureItem.count({ where: { kioskDocumentId } })
    ]);
    return legacySequenceCount + templateSequenceCount;
  }
}
