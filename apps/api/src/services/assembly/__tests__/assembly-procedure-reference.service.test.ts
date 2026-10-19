import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureReferenceService } from '../assembly-procedure-reference.service.js';

describe('AssemblyProcedureReferenceService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts procedure manual assignments so an assigned kiosk PDF cannot be deleted', async () => {
    vi.spyOn(prisma.assemblyProcedureOrderItem, 'count').mockResolvedValue(0 as never);
    vi.spyOn(prisma.assemblyTemplateProcedureItem, 'count').mockResolvedValue(0 as never);
    vi.spyOn(prisma.assemblyTemplateProcedureStep, 'count').mockResolvedValue(0 as never);
    const manualCount = vi.spyOn(prisma.procedureManualAssignment, 'count').mockResolvedValue(2 as never);

    const count = await new AssemblyProcedureReferenceService().countKioskDocumentReferences('pdf-1');

    expect(count).toBe(2);
    expect(manualCount).toHaveBeenCalledWith({ where: { kioskDocumentId: 'pdf-1' } });
  });

  it('returns zero when no sequence, step or assignment references the document', async () => {
    vi.spyOn(prisma.assemblyProcedureOrderItem, 'count').mockResolvedValue(0 as never);
    vi.spyOn(prisma.assemblyTemplateProcedureItem, 'count').mockResolvedValue(0 as never);
    vi.spyOn(prisma.assemblyTemplateProcedureStep, 'count').mockResolvedValue(0 as never);
    vi.spyOn(prisma.procedureManualAssignment, 'count').mockResolvedValue(0 as never);

    await expect(new AssemblyProcedureReferenceService().countKioskDocumentReferences('pdf-2')).resolves.toBe(0);
  });
});
