import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../production-schedule/production-schedule-settings.service.js';

export type AssemblyProcedureOrderDocumentSummary = {
  id: string;
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  enabled: boolean;
  updatedAt: Date;
  filePath: string;
};

export type AssemblyProcedureOrderItemSummary = {
  id: string;
  sortOrder: number;
  label: string | null;
  kioskDocumentId: string;
  document: AssemblyProcedureOrderDocumentSummary;
};

export type AssemblyProcedureOrder = {
  id: string | null;
  machineName: string;
  machineNameKey: string;
  configured: boolean;
  items: AssemblyProcedureOrderItemSummary[];
};

export type AssemblyProcedureOrderSaveItemInput = {
  kioskDocumentId: string;
  label?: string | null;
};

const ORDER_DOCUMENT_SELECT = {
  id: true,
  title: true,
  displayTitle: true,
  filename: true,
  confirmedDocumentNumber: true,
  confirmedSummaryText: true,
  pageCount: true,
  enabled: true,
  updatedAt: true,
  filePath: true
} as const;

function normalizeMachineName(value: string): { machineName: string; machineNameKey: string } {
  const machineNameKey = normalizeMachineNameForCompare(value);
  if (!machineNameKey) {
    throw new ApiError(400, '機種名が必要です');
  }
  return {
    machineName: machineNameKey.slice(0, 120),
    machineNameKey: machineNameKey.slice(0, 120)
  };
}

function normalizeLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null;
}

function normalizeSaveItems(items: AssemblyProcedureOrderSaveItemInput[]): AssemblyProcedureOrderSaveItemInput[] {
  return items.slice(0, 50).map((item) => ({
    kioskDocumentId: item.kioskDocumentId,
    label: normalizeLabel(item.label)
  }));
}

export class AssemblyProcedureOrderService {
  async verifyAccessPassword(password: string): Promise<{ success: boolean }> {
    return verifyDueManagementAccessPassword({
      location: SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
      password
    });
  }

  async requireAccessPassword(password: string): Promise<void> {
    const result = await this.verifyAccessPassword(password);
    if (!result.success) {
      throw new ApiError(403, '閲覧順設定パスワードが違います');
    }
  }

  async getByMachineName(machineNameInput: string, options: { enabledOnly?: boolean } = {}): Promise<AssemblyProcedureOrder> {
    const { machineName, machineNameKey } = normalizeMachineName(machineNameInput);
    const set = await prisma.assemblyProcedureOrderSet.findUnique({
      where: { machineNameKey },
      include: {
        items: {
          where: options.enabledOnly ? { kioskDocument: { enabled: true } } : {},
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            kioskDocument: {
              select: ORDER_DOCUMENT_SELECT
            }
          }
        }
      }
    });

    const items =
      set?.items.map((item) => ({
        id: item.id,
        sortOrder: item.sortOrder,
        label: item.label,
        kioskDocumentId: item.kioskDocumentId,
        document: item.kioskDocument
      })) ?? [];

    return {
      id: set?.id ?? null,
      machineName: set?.machineName ?? machineName,
      machineNameKey,
      configured: items.length > 0,
      items
    };
  }

  async save(params: {
    machineName: string;
    accessPassword: string;
    items: AssemblyProcedureOrderSaveItemInput[];
  }): Promise<AssemblyProcedureOrder> {
    await this.requireAccessPassword(params.accessPassword);
    const { machineName, machineNameKey } = normalizeMachineName(params.machineName);
    const items = normalizeSaveItems(params.items);

    if (items.length === 0) {
      await prisma.assemblyProcedureOrderSet.deleteMany({ where: { machineNameKey } });
      return this.getByMachineName(machineName);
    }

    const documentIds = [...new Set(items.map((item) => item.kioskDocumentId))];
    const validDocuments = await prisma.kioskDocument.findMany({
      where: {
        id: { in: documentIds },
        enabled: true
      },
      select: { id: true }
    });
    if (validDocuments.length !== documentIds.length) {
      throw new ApiError(400, '有効な要領書PDFを選択してください');
    }

    await prisma.$transaction(async (tx) => {
      const set = await tx.assemblyProcedureOrderSet.upsert({
        where: { machineNameKey },
        create: { machineName, machineNameKey },
        update: { machineName }
      });
      await tx.assemblyProcedureOrderItem.deleteMany({ where: { setId: set.id } });
      await tx.assemblyProcedureOrderItem.createMany({
        data: items.map((item, index) => ({
          setId: set.id,
          kioskDocumentId: item.kioskDocumentId,
          sortOrder: index,
          label: item.label
        }))
      });
    });

    return this.getByMachineName(machineName);
  }

  async countKioskDocumentReferences(kioskDocumentId: string): Promise<number> {
    return prisma.assemblyProcedureOrderItem.count({
      where: { kioskDocumentId }
    });
  }
}
