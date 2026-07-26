import { prisma } from '../../lib/prisma.js';

export class AssemblyProcedureReferenceService {
  async countKioskDocumentReferences(kioskDocumentId: string): Promise<number> {
    const [legacySequenceCount, templateSequenceCount, templateStepCount] = await Promise.all([
      prisma.assemblyProcedureOrderItem.count({ where: { kioskDocumentId } }),
      prisma.assemblyTemplateProcedureItem.count({ where: { kioskDocumentId } }),
      prisma.assemblyTemplateProcedureStep.count({ where: { kioskDocumentId } })
    ]);
    return legacySequenceCount + templateSequenceCount + templateStepCount;
  }
}
