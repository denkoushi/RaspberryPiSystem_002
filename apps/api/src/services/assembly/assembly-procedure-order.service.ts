import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import {
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION,
  verifyDueManagementAccessPassword
} from '../production-schedule/production-schedule-settings.service.js';

export type AssemblyProcedureOrderDocumentType = 'kiosk_document' | 'assembly_procedure_document';

export type AssemblyProcedureOrderDocumentSummary = {
  id: string;
  documentType: AssemblyProcedureOrderDocumentType;
  title: string;
  displayTitle: string | null;
  filename: string;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  pageCount: number | null;
  enabled: boolean;
  status: 'draft' | 'published' | null;
  updatedAt: Date;
  filePath: string | null;
  imageRelativePath: string | null;
};

export type AssemblyProcedureOrderItemSummary = {
  id: string;
  sortOrder: number;
  label: string | null;
  documentType: AssemblyProcedureOrderDocumentType;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
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
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  label?: string | null;
};

const ORDER_KIOSK_DOCUMENT_SELECT = {
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

const ORDER_ASSEMBLY_PROCEDURE_DOCUMENT_SELECT = {
  id: true,
  name: true,
  imageRelativePath: true,
  isActive: true,
  status: true,
  updatedAt: true,
  pages: {
    orderBy: { pageIndex: 'asc' as const },
    select: { pageIndex: true, imageRelativePath: true }
  }
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

function normalizeReferenceId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSaveItems(items: AssemblyProcedureOrderSaveItemInput[]): Array<{
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  label: string | null;
}> {
  return items.slice(0, 50).map((item, index) => {
    const kioskDocumentId = normalizeReferenceId(item.kioskDocumentId);
    const assemblyProcedureDocumentId = normalizeReferenceId(item.assemblyProcedureDocumentId);
    const hasKiosk = kioskDocumentId != null;
    const hasAssembly = assemblyProcedureDocumentId != null;
    if (hasKiosk === hasAssembly) {
      throw new ApiError(400, `閲覧順${index + 1}件目: 要領書PDFまたは組立手順書のどちらか一方を指定してください`);
    }
    return {
      kioskDocumentId,
      assemblyProcedureDocumentId,
      label: normalizeLabel(item.label)
    };
  });
}

function mapKioskDocumentSummary(document: {
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
}): AssemblyProcedureOrderDocumentSummary {
  return {
    id: document.id,
    documentType: 'kiosk_document',
    title: document.title,
    displayTitle: document.displayTitle,
    filename: document.filename,
    confirmedDocumentNumber: document.confirmedDocumentNumber,
    confirmedSummaryText: document.confirmedSummaryText,
    pageCount: document.pageCount,
    enabled: document.enabled,
    status: null,
    updatedAt: document.updatedAt,
    filePath: document.filePath,
    imageRelativePath: null
  };
}

function mapAssemblyProcedureDocumentSummary(document: {
  id: string;
  name: string;
  imageRelativePath: string;
  isActive: boolean;
  status: 'DRAFT' | 'PUBLISHED';
  updatedAt: Date;
  pages: Array<{ pageIndex: number; imageRelativePath: string }>;
}): AssemblyProcedureOrderDocumentSummary {
  const pageCount = document.pages.length > 0 ? document.pages.length : 1;
  return {
    id: document.id,
    documentType: 'assembly_procedure_document',
    title: document.name,
    displayTitle: null,
    filename: document.name,
    confirmedDocumentNumber: null,
    confirmedSummaryText: null,
    pageCount,
    enabled: document.isActive,
    status: document.status === 'PUBLISHED' ? 'published' : 'draft',
    updatedAt: document.updatedAt,
    filePath: null,
    imageRelativePath: document.imageRelativePath
  };
}

function mapOrderItem(item: {
  id: string;
  sortOrder: number;
  label: string | null;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  kioskDocument: {
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
  } | null;
  assemblyProcedureDocument: {
    id: string;
    name: string;
    imageRelativePath: string;
    isActive: boolean;
    status: 'DRAFT' | 'PUBLISHED';
    updatedAt: Date;
    pages: Array<{ pageIndex: number; imageRelativePath: string }>;
  } | null;
}): AssemblyProcedureOrderItemSummary {
  if (item.kioskDocument) {
    return {
      id: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: 'kiosk_document',
      kioskDocumentId: item.kioskDocumentId,
      assemblyProcedureDocumentId: null,
      document: mapKioskDocumentSummary(item.kioskDocument)
    };
  }
  if (item.assemblyProcedureDocument) {
    return {
      id: item.id,
      sortOrder: item.sortOrder,
      label: item.label,
      documentType: 'assembly_procedure_document',
      kioskDocumentId: null,
      assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
      document: mapAssemblyProcedureDocumentSummary(item.assemblyProcedureDocument)
    };
  }
  throw new ApiError(500, '閲覧順設定の参照先が不正です');
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
          where: options.enabledOnly
            ? {
                OR: [{ kioskDocument: { enabled: true } }, { assemblyProcedureDocument: { isActive: true } }]
              }
            : {},
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            kioskDocument: {
              select: ORDER_KIOSK_DOCUMENT_SELECT
            },
            assemblyProcedureDocument: {
              select: ORDER_ASSEMBLY_PROCEDURE_DOCUMENT_SELECT
            }
          }
        }
      }
    });

    const items = set?.items.map((item) => mapOrderItem(item)) ?? [];

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

    const kioskDocumentIds = [...new Set(items.map((item) => item.kioskDocumentId).filter((id): id is string => id != null))];
    const assemblyProcedureDocumentIds = [
      ...new Set(items.map((item) => item.assemblyProcedureDocumentId).filter((id): id is string => id != null))
    ];

    if (kioskDocumentIds.length > 0) {
      const validDocuments = await prisma.kioskDocument.findMany({
        where: {
          id: { in: kioskDocumentIds },
          enabled: true
        },
        select: { id: true }
      });
      if (validDocuments.length !== kioskDocumentIds.length) {
        throw new ApiError(400, '有効な要領書PDFを選択してください');
      }
    }

    if (assemblyProcedureDocumentIds.length > 0) {
      const validDocuments = await prisma.assemblyProcedureDocument.findMany({
        where: {
          id: { in: assemblyProcedureDocumentIds },
          isActive: true,
          status: 'PUBLISHED'
        },
        select: { id: true }
      });
      if (validDocuments.length !== assemblyProcedureDocumentIds.length) {
        throw new ApiError(400, '公開済みで有効な組立手順書を選択してください');
      }
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
          assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
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

  async countAssemblyProcedureDocumentReferences(assemblyProcedureDocumentId: string): Promise<number> {
    return prisma.assemblyProcedureOrderItem.count({
      where: { assemblyProcedureDocumentId }
    });
  }
}
