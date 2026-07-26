import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import {
  assemblyProcedureSequenceAssemblyDocumentSelect,
  assemblyProcedureSequenceKioskDocumentSelect,
  mapAssemblyProcedureSequenceItem,
  type AssemblyProcedureSequenceItemSummary
} from './assembly-procedure-sequence-item.js';

export type AssemblyLegacyProcedureOrder = {
  machineName: string;
  machineNameKey: string;
  items: AssemblyProcedureSequenceItemSummary[];
};

/**
 * Read-only compatibility adapter for templates created before procedure
 * sequences became template-version owned. No public API may mutate this data.
 */
export class AssemblyLegacyProcedureOrderService {
  async getByMachineName(machineNameInput: string): Promise<AssemblyLegacyProcedureOrder> {
    const machineNameKey = normalizeMachineNameForCompare(machineNameInput);
    if (!machineNameKey) {
      throw new ApiError(400, '機種名が必要です');
    }
    const set = await prisma.assemblyProcedureOrderSet.findUnique({
      where: { machineNameKey },
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            kioskDocument: {
              select: assemblyProcedureSequenceKioskDocumentSelect
            },
            assemblyProcedureDocument: {
              select: assemblyProcedureSequenceAssemblyDocumentSelect
            }
          }
        }
      }
    });

    return {
      machineName: set?.machineName ?? machineNameKey.slice(0, 120),
      machineNameKey: machineNameKey.slice(0, 120),
      items: set?.items.map(mapAssemblyProcedureSequenceItem) ?? []
    };
  }
}
