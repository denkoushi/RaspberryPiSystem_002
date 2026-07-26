import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import { AssemblyLegacyProcedureOrderService } from './assembly-legacy-procedure-order.service.js';
import {
  assemblyProcedureSequenceAssemblyDocumentSelect,
  assemblyProcedureSequenceKioskDocumentSelect,
  mapAssemblyProcedureSequenceItem,
  type AssemblyProcedureSequenceItemSummary
} from './assembly-procedure-sequence-item.js';

export type AssemblyTemplateProcedureSequenceSource =
  | 'template_version'
  | 'legacy_machine_order'
  | 'primary_fallback';

export type AssemblyTemplateProcedureItemInput = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  label?: string | null;
};

export type NormalizedAssemblyTemplateProcedureItem = {
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  label: string | null;
};

export type AssemblyTemplateProcedureSequence = {
  source: AssemblyTemplateProcedureSequenceSource;
  items: AssemblyProcedureSequenceItemSummary[];
};

export const assemblyTemplateProcedureItemsInclude = {
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  include: {
    kioskDocument: { select: assemblyProcedureSequenceKioskDocumentSelect },
    assemblyProcedureDocument: { select: assemblyProcedureSequenceAssemblyDocumentSelect }
  }
};

type ProcedureItemRow = Prisma.AssemblyTemplateProcedureItemGetPayload<{
  include: typeof assemblyTemplateProcedureItemsInclude.include;
}>;

type ProcedureItemLike = Pick<
  ProcedureItemRow,
  | 'id'
  | 'sortOrder'
  | 'label'
  | 'kioskDocumentId'
  | 'assemblyProcedureDocumentId'
  | 'kioskDocument'
  | 'assemblyProcedureDocument'
>;

type TemplateForSequence = {
  id: string;
  modelCode: string;
  procedureDocumentId: string;
  procedureDocument: {
    id: string;
    name: string;
    imageRelativePath: string;
    isActive: boolean;
    status: 'DRAFT' | 'PUBLISHED';
    updatedAt: Date;
    pages: Array<{ pageIndex: number; imageRelativePath: string }>;
  };
  procedureItems: ProcedureItemRow[];
};

function normalizeReferenceId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized.slice(0, 120) : null;
}

export function normalizeAssemblyTemplateProcedureItems(
  procedureDocumentId: string,
  items: AssemblyTemplateProcedureItemInput[]
): NormalizedAssemblyTemplateProcedureItem[] {
  if (items.length < 1 || items.length > 50) {
    throw new ApiError(400, '手順書閲覧順は1件以上50件以下にしてください');
  }

  const normalized = items.map((item, index) => {
    const kioskDocumentId = normalizeReferenceId(item.kioskDocumentId);
    const assemblyProcedureDocumentId = normalizeReferenceId(item.assemblyProcedureDocumentId);
    if ((kioskDocumentId == null) === (assemblyProcedureDocumentId == null)) {
      throw new ApiError(
        400,
        `手順書閲覧順${index + 1}件目: 要領書PDFまたは組立手順書のどちらか一方を指定してください`
      );
    }
    return {
      kioskDocumentId,
      assemblyProcedureDocumentId,
      label: normalizeLabel(item.label)
    };
  });

  const firstAssemblyDocumentId = normalized.find(
    (item) => item.assemblyProcedureDocumentId != null
  )?.assemblyProcedureDocumentId;
  if (!firstAssemblyDocumentId) {
    throw new ApiError(400, '手順書閲覧順には組立手順書が1件以上必要です');
  }
  if (firstAssemblyDocumentId !== procedureDocumentId) {
    throw new ApiError(400, '主手順書は閲覧順で最初の組立手順書と一致させてください');
  }
  return normalized;
}

export function collectTemplateProcedureDocumentKeys(
  items: NormalizedAssemblyTemplateProcedureItem[]
): Set<string> {
  return new Set(
    items.map((item) =>
      item.kioskDocumentId
        ? `kiosk_document:${item.kioskDocumentId}`
        : `assembly_procedure_document:${item.assemblyProcedureDocumentId}`
    )
  );
}

export function mapTemplateProcedureItem(
  item: ProcedureItemLike
): AssemblyProcedureSequenceItemSummary {
  return mapAssemblyProcedureSequenceItem(item);
}

function buildPrimaryFallback(template: TemplateForSequence): AssemblyProcedureSequenceItemSummary {
  const document = template.procedureDocument;
  return {
    id: `template-primary:${template.id}`,
    sortOrder: 0,
    label: null,
    documentType: 'assembly_procedure_document',
    kioskDocumentId: null,
    assemblyProcedureDocumentId: document.id,
    document: {
      id: document.id,
      documentType: 'assembly_procedure_document',
      title: document.name,
      displayTitle: null,
      filename: document.name,
      confirmedDocumentNumber: null,
      confirmedSummaryText: null,
      pageCount: document.pages.length > 0 ? document.pages.length : 1,
      enabled: document.isActive,
      status: document.status === 'PUBLISHED' ? 'published' : 'draft',
      updatedAt: document.updatedAt,
      filePath: null,
      imageRelativePath: document.imageRelativePath
    }
  };
}

export class AssemblyTemplateProcedureSequenceService {
  constructor(
    private readonly legacyOrderService = new AssemblyLegacyProcedureOrderService()
  ) {}

  async validateDocuments(
    tx: Prisma.TransactionClient,
    items: NormalizedAssemblyTemplateProcedureItem[],
    allowedKioskDocumentIds: ReadonlySet<string>
  ): Promise<void> {
    const kioskDocumentIds = [
      ...new Set(items.map((item) => item.kioskDocumentId).filter((id): id is string => id != null))
    ];
    const assemblyProcedureDocumentIds = [
      ...new Set(
        items
          .map((item) => item.assemblyProcedureDocumentId)
          .filter((id): id is string => id != null)
      )
    ];
    const [kioskDocuments, assemblyDocuments] = await Promise.all([
      kioskDocumentIds.length > 0
        ? tx.kioskDocument.findMany({
            // KioskDocument rows are legacy-only sequence members. They are not
            // newly addable in the unified UI, but must survive a later revision
            // even when an operator has disabled the document in the kiosk library.
            where: { id: { in: kioskDocumentIds } },
            select: { id: true }
          })
        : [],
      assemblyProcedureDocumentIds.length > 0
        ? tx.assemblyProcedureDocument.findMany({
            where: {
              id: { in: assemblyProcedureDocumentIds },
              isActive: true,
              status: 'PUBLISHED'
            },
            select: { id: true }
          })
        : []
    ]);
    if (kioskDocuments.length !== kioskDocumentIds.length) {
      throw new ApiError(400, '存在する要領書PDFを選択してください');
    }
    if (kioskDocumentIds.some((id) => !allowedKioskDocumentIds.has(id))) {
      throw new ApiError(
        400,
        '要領書PDFは既存の閲覧順からのみ引き継げます。新規追加には公開済みの組立手順書を選択してください'
      );
    }
    if (assemblyDocuments.length !== assemblyProcedureDocumentIds.length) {
      throw new ApiError(400, '公開済みで有効な組立手順書を選択してください');
    }
  }

  async findLegacyKioskDocumentIds(
    tx: Prisma.TransactionClient,
    machineName: string
  ): Promise<Set<string>> {
    const machineNameKey = normalizeMachineNameForCompare(machineName);
    if (!machineNameKey) return new Set();
    const set = await tx.assemblyProcedureOrderSet.findUnique({
      where: { machineNameKey },
      select: {
        items: {
          where: { kioskDocumentId: { not: null } },
          select: { kioskDocumentId: true }
        }
      }
    });
    return new Set(
      (set?.items ?? [])
        .map((item) => item.kioskDocumentId)
        .filter((id): id is string => id != null)
    );
  }

  async createItems(
    tx: Prisma.TransactionClient,
    templateId: string,
    items: NormalizedAssemblyTemplateProcedureItem[]
  ): Promise<void> {
    await tx.assemblyTemplateProcedureItem.createMany({
      data: items.map((item, sortOrder) => ({
        templateId,
        kioskDocumentId: item.kioskDocumentId,
        assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
        sortOrder,
        label: item.label
      }))
    });
  }

  async resolveForTemplate(template: TemplateForSequence): Promise<AssemblyTemplateProcedureSequence> {
    if (template.procedureItems.length > 0) {
      return {
        source: 'template_version',
        items: template.procedureItems.map(mapTemplateProcedureItem)
      };
    }
    const legacy = await this.legacyOrderService.getByMachineName(template.modelCode);
    if (legacy.items.length > 0) {
      logger.info(
        { templateId: template.id, modelCode: template.modelCode },
        'assembly_template_legacy_procedure_order_fallback'
      );
      return { source: 'legacy_machine_order', items: legacy.items };
    }
    return { source: 'primary_fallback', items: [buildPrimaryFallback(template)] };
  }

  async resolveManyForTemplates(
    templates: TemplateForSequence[]
  ): Promise<Map<string, AssemblyTemplateProcedureSequence>> {
    const result = new Map<string, AssemblyTemplateProcedureSequence>();
    const legacyTemplates: TemplateForSequence[] = [];
    for (const template of templates) {
      if (template.procedureItems.length > 0) {
        result.set(template.id, {
          source: 'template_version',
          items: template.procedureItems.map(mapTemplateProcedureItem)
        });
      } else {
        legacyTemplates.push(template);
      }
    }
    if (legacyTemplates.length === 0) return result;

    const keys = [
      ...new Set(
        legacyTemplates
          .map((template) => normalizeMachineNameForCompare(template.modelCode))
          .filter((key) => key.length > 0)
      )
    ];
    const orderSets =
      keys.length > 0
        ? await prisma.assemblyProcedureOrderSet.findMany({
            where: { machineNameKey: { in: keys } },
            include: {
              items: assemblyTemplateProcedureItemsInclude
            }
          })
        : [];
    const itemsByMachineName = new Map(
      orderSets.map((set) => [set.machineNameKey, set.items.map(mapTemplateProcedureItem)] as const)
    );
    for (const template of legacyTemplates) {
      const items =
        itemsByMachineName.get(normalizeMachineNameForCompare(template.modelCode)) ?? [];
      if (items.length > 0) {
        result.set(template.id, { source: 'legacy_machine_order', items });
      } else {
        result.set(template.id, {
          source: 'primary_fallback',
          items: [buildPrimaryFallback(template)]
        });
      }
    }
    return result;
  }
}
