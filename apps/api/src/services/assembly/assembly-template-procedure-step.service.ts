import {
  ASSEMBLY_PROCEDURE_STEP_INSTRUCTION_MAX_LENGTH,
  ASSEMBLY_PROCEDURE_STEP_MAX_COUNT,
  ASSEMBLY_PROCEDURE_STEP_TITLE_MAX_LENGTH,
  isAssemblyProcedurePointInCrop,
  isValidAssemblyProcedureCropRect,
  type AssemblyProcedureCropRect,
  type AssemblyProcedureStepEmphasis,
  type AssemblyProcedureStepViewMode
} from '@raspi-system/shared-types';
import type { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import type {
  AssemblyTemplateProcedureItemInput,
  NormalizedAssemblyTemplateProcedureItem
} from './assembly-template-procedure-sequence.service.js';

export type AssemblyTemplateProcedureStepInput = {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex: number;
  viewMode: AssemblyProcedureStepViewMode;
  cropXRatio?: number | null;
  cropYRatio?: number | null;
  cropWidthRatio?: number | null;
  cropHeightRatio?: number | null;
  title?: string | null;
  instructionText?: string | null;
  emphasis?: AssemblyProcedureStepEmphasis;
};

export type NormalizedAssemblyTemplateProcedureStep = {
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
  viewMode: AssemblyProcedureStepViewMode;
  cropXRatio: number | null;
  cropYRatio: number | null;
  cropWidthRatio: number | null;
  cropHeightRatio: number | null;
  title: string | null;
  instructionText: string | null;
  emphasis: AssemblyProcedureStepEmphasis;
};

export type AssemblyTemplateProcedureStepSummary = NormalizedAssemblyTemplateProcedureStep & {
  id: string;
  sortOrder: number;
};

export type AssemblyTemplateProcedureStepSource = 'template_steps' | 'document_expansion';

export const assemblyTemplateProcedureStepsInclude = {
  orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }]
};

type StoredProcedureStep = {
  id: string;
  sortOrder: number;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
  viewMode: AssemblyProcedureStepViewMode;
  cropXRatio: unknown;
  cropYRatio: unknown;
  cropWidthRatio: unknown;
  cropHeightRatio: unknown;
  title: string | null;
  instructionText: string | null;
  emphasis: AssemblyProcedureStepEmphasis;
};

type MarkerLike = {
  markerNo: number;
  xRatio: number | Prisma.Decimal;
  yRatio: number | Prisma.Decimal;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number | null;
};

type ProcedureDocumentLike = {
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  document: { pageCount: number | null };
};

function normalizeReferenceId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalText(
  value: string | null | undefined,
  maximumLength: number,
  label: string,
  index: number
): string | null {
  const normalized = value?.trim() ?? '';
  if (normalized.length > maximumLength) {
    throw new ApiError(
      400,
      `表示ステップ${index + 1}件目: ${label}は${maximumLength}文字以内にしてください`
    );
  }
  return normalized.length > 0 ? normalized : null;
}

export function assemblyProcedureDocumentKey(reference: {
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
}): string {
  return reference.kioskDocumentId
    ? `kiosk_document:${reference.kioskDocumentId}`
    : `assembly_procedure_document:${reference.assemblyProcedureDocumentId}`;
}

export function normalizeAssemblyTemplateProcedureSteps(
  steps: AssemblyTemplateProcedureStepInput[]
): NormalizedAssemblyTemplateProcedureStep[] {
  if (steps.length < 1 || steps.length > ASSEMBLY_PROCEDURE_STEP_MAX_COUNT) {
    throw new ApiError(
      400,
      `表示ステップは1件以上${ASSEMBLY_PROCEDURE_STEP_MAX_COUNT}件以下にしてください`
    );
  }
  return steps.map((step, index) => {
    const kioskDocumentId = normalizeReferenceId(step.kioskDocumentId);
    const assemblyProcedureDocumentId = normalizeReferenceId(
      step.assemblyProcedureDocumentId
    );
    if ((kioskDocumentId == null) === (assemblyProcedureDocumentId == null)) {
      throw new ApiError(
        400,
        `表示ステップ${index + 1}件目: 文書参照はどちらか一方だけ指定してください`
      );
    }
    if (!Number.isInteger(step.pageIndex) || step.pageIndex < 0) {
      throw new ApiError(400, `表示ステップ${index + 1}件目: ページ番号が不正です`);
    }
    if (step.viewMode !== 'FULL_PAGE' && step.viewMode !== 'CROP') {
      throw new ApiError(400, `表示ステップ${index + 1}件目: 表示形式が不正です`);
    }
    const cropValues = [
      step.cropXRatio,
      step.cropYRatio,
      step.cropWidthRatio,
      step.cropHeightRatio
    ];
    const crop: AssemblyProcedureCropRect | null =
      cropValues.every((value) => typeof value === 'number')
        ? {
            xRatio: step.cropXRatio!,
            yRatio: step.cropYRatio!,
            widthRatio: step.cropWidthRatio!,
            heightRatio: step.cropHeightRatio!
          }
        : null;
    if (step.viewMode === 'FULL_PAGE' && cropValues.some((value) => value != null)) {
      throw new ApiError(
        400,
        `表示ステップ${index + 1}件目: 全体表示には矩形座標を指定できません`
      );
    }
    if (step.viewMode === 'CROP' && (!crop || !isValidAssemblyProcedureCropRect(crop))) {
      throw new ApiError(
        400,
        `表示ステップ${index + 1}件目: 矩形はページ内で幅・高さ2%以上にしてください`
      );
    }
    const emphasis = step.emphasis ?? 'NORMAL';
    if (emphasis !== 'NORMAL' && emphasis !== 'IMPORTANT' && emphasis !== 'CAUTION') {
      throw new ApiError(400, `表示ステップ${index + 1}件目: 重要度が不正です`);
    }
    return {
      kioskDocumentId,
      assemblyProcedureDocumentId,
      pageIndex: step.pageIndex,
      viewMode: step.viewMode,
      cropXRatio: crop?.xRatio ?? null,
      cropYRatio: crop?.yRatio ?? null,
      cropWidthRatio: crop?.widthRatio ?? null,
      cropHeightRatio: crop?.heightRatio ?? null,
      title: normalizeOptionalText(
        step.title,
        ASSEMBLY_PROCEDURE_STEP_TITLE_MAX_LENGTH,
        'タイトル',
        index
      ),
      instructionText: normalizeOptionalText(
        step.instructionText,
        ASSEMBLY_PROCEDURE_STEP_INSTRUCTION_MAX_LENGTH,
        '指示文',
        index
      ),
      emphasis
    };
  });
}

export function normalizeProcedureItemsForExplicitSteps(
  procedureDocumentId: string,
  items: NormalizedAssemblyTemplateProcedureItem[],
  steps: NormalizedAssemblyTemplateProcedureStep[]
): NormalizedAssemblyTemplateProcedureItem[] {
  const itemByKey = new Map<string, NormalizedAssemblyTemplateProcedureItem>();
  for (const item of items) {
    const key = assemblyProcedureDocumentKey(item);
    if (itemByKey.has(key)) {
      throw new ApiError(400, '表示ステップを使う場合、文書列に同じ文書を重複指定できません');
    }
    itemByKey.set(key, item);
  }
  const orderedKeys = [...new Set(steps.map(assemblyProcedureDocumentKey))];
  const unknown = orderedKeys.find((key) => !itemByKey.has(key));
  if (unknown) {
    throw new ApiError(400, '表示ステップが参照する文書を文書列へ追加してください');
  }
  const unused = [...itemByKey.keys()].find((key) => !orderedKeys.includes(key));
  if (unused) {
    throw new ApiError(400, '文書列の各文書は表示ステップで1回以上使用してください');
  }
  const ordered = orderedKeys.map((key) => itemByKey.get(key)!);
  const firstAssemblyDocumentId = ordered.find(
    (item) => item.assemblyProcedureDocumentId != null
  )?.assemblyProcedureDocumentId;
  if (firstAssemblyDocumentId !== procedureDocumentId) {
    throw new ApiError(
      400,
      '主手順書は表示ステップで最初に現れる組立手順書と一致させてください'
    );
  }
  return ordered;
}

export class AssemblyTemplateProcedureStepService {
  async validatePages(
    tx: Prisma.TransactionClient,
    steps: NormalizedAssemblyTemplateProcedureStep[]
  ): Promise<void> {
    const kioskIds = [
      ...new Set(steps.flatMap((step) => (step.kioskDocumentId ? [step.kioskDocumentId] : [])))
    ];
    const assemblyIds = [
      ...new Set(
        steps.flatMap((step) =>
          step.assemblyProcedureDocumentId ? [step.assemblyProcedureDocumentId] : []
        )
      )
    ];
    const [kioskDocuments, assemblyDocuments] = await Promise.all([
      kioskIds.length
        ? tx.kioskDocument.findMany({
            where: { id: { in: kioskIds } },
            select: { id: true, pageCount: true }
          })
        : [],
      assemblyIds.length
        ? tx.assemblyProcedureDocument.findMany({
            where: { id: { in: assemblyIds }, isActive: true, status: 'PUBLISHED' },
            select: { id: true, pages: { select: { pageIndex: true } } }
          })
        : []
    ]);
    const kioskPageCounts = new Map(
      kioskDocuments.map((document) => [document.id, Math.max(1, document.pageCount ?? 1)])
    );
    const assemblyPages = new Map(
      assemblyDocuments.map((document) => [
        document.id,
        new Set(
          document.pages.length > 0
            ? document.pages.map((page) => page.pageIndex)
            : [0]
        )
      ])
    );
    for (const [index, step] of steps.entries()) {
      const valid = step.kioskDocumentId
        ? step.pageIndex < (kioskPageCounts.get(step.kioskDocumentId) ?? 0)
        : (assemblyPages.get(step.assemblyProcedureDocumentId!)?.has(step.pageIndex) ?? false);
      if (!valid) {
        throw new ApiError(
          400,
          `表示ステップ${index + 1}件目: 存在する公開ページを指定してください`
        );
      }
    }
  }

  assertMarkersVisible(
    steps: NormalizedAssemblyTemplateProcedureStep[],
    markers: MarkerLike[]
  ): void {
    for (const marker of markers) {
      const markerReference = {
        kioskDocumentId: marker.kioskDocumentId ?? null,
        assemblyProcedureDocumentId: marker.assemblyProcedureDocumentId ?? null
      };
      const visible = steps.some((step) => {
        if (
          assemblyProcedureDocumentKey(step) !== assemblyProcedureDocumentKey(markerReference) ||
          step.pageIndex !== (marker.pageIndex ?? 0)
        ) {
          return false;
        }
        if (step.viewMode === 'FULL_PAGE') return true;
        return isAssemblyProcedurePointInCrop(
          { xRatio: Number(marker.xRatio), yRatio: Number(marker.yRatio) },
          {
            xRatio: step.cropXRatio!,
            yRatio: step.cropYRatio!,
            widthRatio: step.cropWidthRatio!,
            heightRatio: step.cropHeightRatio!
          }
        );
      });
      if (!visible) {
        throw new ApiError(
          400,
          `丸数字／チェック${marker.markerNo}: マーカーが見える表示ステップを1件以上残してください`
        );
      }
    }
  }

  async createSteps(
    tx: Prisma.TransactionClient,
    templateId: string,
    steps: NormalizedAssemblyTemplateProcedureStep[]
  ): Promise<void> {
    await tx.assemblyTemplateProcedureStep.createMany({
      data: steps.map((step, sortOrder) => ({ ...step, sortOrder, templateId }))
    });
  }

  mapStoredSteps(steps: StoredProcedureStep[]): AssemblyTemplateProcedureStepSummary[] {
    return steps.map((step) => ({
      id: step.id,
      sortOrder: step.sortOrder,
      kioskDocumentId: step.kioskDocumentId,
      assemblyProcedureDocumentId: step.assemblyProcedureDocumentId,
      pageIndex: step.pageIndex,
      viewMode: step.viewMode,
      cropXRatio: step.cropXRatio == null ? null : Number(step.cropXRatio),
      cropYRatio: step.cropYRatio == null ? null : Number(step.cropYRatio),
      cropWidthRatio: step.cropWidthRatio == null ? null : Number(step.cropWidthRatio),
      cropHeightRatio: step.cropHeightRatio == null ? null : Number(step.cropHeightRatio),
      title: step.title,
      instructionText: step.instructionText,
      emphasis: step.emphasis
    }));
  }

  expandDocuments(items: ProcedureDocumentLike[]): AssemblyTemplateProcedureStepSummary[] {
    let sortOrder = 0;
    return items.flatMap((item) =>
      Array.from({ length: Math.max(1, item.document.pageCount ?? 1) }, (_, pageIndex) => ({
        id: `document-expansion:${assemblyProcedureDocumentKey(item)}:${pageIndex}`,
        sortOrder: sortOrder++,
        kioskDocumentId: item.kioskDocumentId,
        assemblyProcedureDocumentId: item.assemblyProcedureDocumentId,
        pageIndex,
        viewMode: 'FULL_PAGE' as const,
        cropXRatio: null,
        cropYRatio: null,
        cropWidthRatio: null,
        cropHeightRatio: null,
        title: null,
        instructionText: null,
        emphasis: 'NORMAL' as const
      }))
    );
  }

  copyInput(steps: StoredProcedureStep[]): AssemblyTemplateProcedureStepInput[] {
    return this.mapStoredSteps(steps).map((step) => ({
      kioskDocumentId: step.kioskDocumentId,
      assemblyProcedureDocumentId: step.assemblyProcedureDocumentId,
      pageIndex: step.pageIndex,
      viewMode: step.viewMode,
      cropXRatio: step.cropXRatio,
      cropYRatio: step.cropYRatio,
      cropWidthRatio: step.cropWidthRatio,
      cropHeightRatio: step.cropHeightRatio,
      title: step.title,
      instructionText: step.instructionText,
      emphasis: step.emphasis
    }));
  }
}

export function procedureItemInputKey(item: AssemblyTemplateProcedureItemInput): string {
  return assemblyProcedureDocumentKey({
    kioskDocumentId: normalizeReferenceId(item.kioskDocumentId),
    assemblyProcedureDocumentId: normalizeReferenceId(item.assemblyProcedureDocumentId)
  });
}
