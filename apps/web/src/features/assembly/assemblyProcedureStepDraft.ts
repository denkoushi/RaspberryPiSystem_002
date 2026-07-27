import {
  ASSEMBLY_PROCEDURE_STEP_MAX_COUNT,
  isAssemblyProcedurePointInCrop,
  type AssemblyProcedureCropRect
} from '@raspi-system/shared-types';

import { projectAssemblyProcedureMarkerToCrop } from './assemblyProcedureMarkerProjection';

import type { AssemblyEditorPageOption } from './assemblyTemplateDraft';
import type { AssemblyTemplateProcedureDraftItem } from './assemblyTemplateProcedureDraft';
import type {
  AssemblyProcedureStepEmphasisDto,
  AssemblyTemplateDto,
  AssemblyTemplateProcedureStepDto
} from './types';

export type AssemblyProcedureStepDraft = {
  localId: string;
  kioskDocumentId: string | null;
  assemblyProcedureDocumentId: string | null;
  pageIndex: number;
  viewMode: 'full_page' | 'crop';
  crop: AssemblyProcedureCropRect | null;
  title: string;
  instructionText: string;
  emphasis: AssemblyProcedureStepEmphasisDto;
};

export type AssemblyProcedureStepDraftAction =
  | { type: 'replace'; steps: AssemblyProcedureStepDraft[] }
  | { type: 'insert'; step: AssemblyProcedureStepDraft; afterLocalId?: string | null }
  | { type: 'append_pages'; pages: AssemblyEditorPageOption[] }
  | { type: 'duplicate'; localId: string }
  | { type: 'remove'; localId: string }
  | { type: 'move'; localId: string; delta: -1 | 1 }
  | { type: 'move_to'; localId: string; targetIndex: number }
  | { type: 'update'; localId: string; patch: Partial<AssemblyProcedureStepDraft> };

export type AssemblyProcedureSourceMarker = {
  id: string;
  markerNo: number;
  xRatio: number;
  yRatio: number;
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
  pageIndex?: number | null;
};

export function assemblyProcedureStepDocumentKey(reference: {
  kioskDocumentId?: string | null;
  assemblyProcedureDocumentId?: string | null;
}): string {
  return reference.kioskDocumentId
    ? `kiosk_document:${reference.kioskDocumentId}`
    : `assembly_procedure_document:${reference.assemblyProcedureDocumentId}`;
}

function createLocalId(seed = 'step'): string {
  return `${seed}:${crypto.randomUUID()}`;
}

export function createFullPageStepDraft(
  page: AssemblyEditorPageOption
): AssemblyProcedureStepDraft {
  return {
    localId: createLocalId(page.key),
    kioskDocumentId: page.source === 'kiosk_document' ? page.documentId : null,
    assemblyProcedureDocumentId:
      page.source === 'assembly_procedure_document' ? page.documentId : null,
    pageIndex: page.pageIndex,
    viewMode: 'full_page',
    crop: null,
    title: '',
    instructionText: '',
    emphasis: 'normal'
  };
}

export function createCropStepDraft(
  page: AssemblyEditorPageOption,
  crop: AssemblyProcedureCropRect
): AssemblyProcedureStepDraft {
  return {
    ...createFullPageStepDraft(page),
    viewMode: 'crop',
    crop
  };
}

function dtoToDraft(step: AssemblyTemplateProcedureStepDto): AssemblyProcedureStepDraft {
  return {
    localId: createLocalId(step.id),
    kioskDocumentId: step.kioskDocumentId,
    assemblyProcedureDocumentId: step.assemblyProcedureDocumentId,
    pageIndex: step.pageIndex,
    viewMode: step.viewMode,
    crop:
      step.viewMode === 'crop'
        ? {
            xRatio: step.cropXRatio!,
            yRatio: step.cropYRatio!,
            widthRatio: step.cropWidthRatio!,
            heightRatio: step.cropHeightRatio!
          }
        : null,
    title: step.title ?? '',
    instructionText: step.instructionText ?? '',
    emphasis: step.emphasis
  };
}

export function templateToProcedureStepDrafts(
  template: AssemblyTemplateDto
): AssemblyProcedureStepDraft[] {
  return (template.procedureSequence?.steps ?? []).map(dtoToDraft);
}

function insertAfter(
  steps: AssemblyProcedureStepDraft[],
  step: AssemblyProcedureStepDraft,
  afterLocalId?: string | null
): AssemblyProcedureStepDraft[] {
  if (steps.length >= ASSEMBLY_PROCEDURE_STEP_MAX_COUNT) return steps;
  const index = afterLocalId ? steps.findIndex((item) => item.localId === afterLocalId) : -1;
  const target = index < 0 ? steps.length : index + 1;
  return [...steps.slice(0, target), step, ...steps.slice(target)];
}

function moveTo(
  steps: AssemblyProcedureStepDraft[],
  localId: string,
  targetIndex: number
): AssemblyProcedureStepDraft[] {
  const sourceIndex = steps.findIndex((step) => step.localId === localId);
  if (sourceIndex < 0) return steps;
  const clamped = Math.max(0, Math.min(steps.length - 1, Math.trunc(targetIndex)));
  if (sourceIndex === clamped) return steps;
  const next = [...steps];
  const [step] = next.splice(sourceIndex, 1);
  next.splice(clamped, 0, step!);
  return next;
}

export function assemblyProcedureStepDraftReducer(
  steps: AssemblyProcedureStepDraft[],
  action: AssemblyProcedureStepDraftAction
): AssemblyProcedureStepDraft[] {
  switch (action.type) {
    case 'replace':
      return action.steps.slice(0, ASSEMBLY_PROCEDURE_STEP_MAX_COUNT);
    case 'insert':
      return insertAfter(steps, action.step, action.afterLocalId);
    case 'append_pages':
      return [
        ...steps,
        ...action.pages
          .slice(0, ASSEMBLY_PROCEDURE_STEP_MAX_COUNT - steps.length)
          .map(createFullPageStepDraft)
      ];
    case 'duplicate': {
      const source = steps.find((step) => step.localId === action.localId);
      return source
        ? insertAfter(
            steps,
            { ...source, localId: createLocalId(source.localId) },
            source.localId
          )
        : steps;
    }
    case 'remove':
      return steps.filter((step) => step.localId !== action.localId);
    case 'move': {
      const index = steps.findIndex((step) => step.localId === action.localId);
      return moveTo(steps, action.localId, index + action.delta);
    }
    case 'move_to':
      return moveTo(steps, action.localId, action.targetIndex);
    case 'update':
      return steps.map((step) =>
        step.localId === action.localId ? { ...step, ...action.patch } : step
      );
  }
}

export function procedureStepDraftToInput(steps: AssemblyProcedureStepDraft[]) {
  return steps.map((step) => ({
    kioskDocumentId: step.kioskDocumentId,
    assemblyProcedureDocumentId: step.assemblyProcedureDocumentId,
    pageIndex: step.pageIndex,
    viewMode: step.viewMode,
    cropXRatio: step.crop?.xRatio ?? null,
    cropYRatio: step.crop?.yRatio ?? null,
    cropWidthRatio: step.crop?.widthRatio ?? null,
    cropHeightRatio: step.crop?.heightRatio ?? null,
    title: step.title.trim() || null,
    instructionText: step.instructionText.trim() || null,
    emphasis: step.emphasis
  }));
}

export function stepMatchesPage(
  step: AssemblyProcedureStepDraft,
  page: AssemblyEditorPageOption
): boolean {
  return (
    assemblyProcedureStepDocumentKey(step) ===
      assemblyProcedureStepDocumentKey({
        kioskDocumentId: page.source === 'kiosk_document' ? page.documentId : null,
        assemblyProcedureDocumentId:
          page.source === 'assembly_procedure_document' ? page.documentId : null
      }) && step.pageIndex === page.pageIndex
  );
}

export function findPageForProcedureStep(
  step: AssemblyProcedureStepDraft,
  pages: AssemblyEditorPageOption[]
): AssemblyEditorPageOption | null {
  return pages.find((page) => stepMatchesPage(step, page)) ?? null;
}

export function isMarkerVisibleInProcedureStep(
  marker: AssemblyProcedureSourceMarker,
  step: AssemblyProcedureStepDraft
): boolean {
  if (
    assemblyProcedureStepDocumentKey(marker) !== assemblyProcedureStepDocumentKey(step) ||
    (marker.pageIndex ?? 0) !== step.pageIndex
  ) {
    return false;
  }
  return (
    step.viewMode === 'full_page' ||
    (step.crop != null &&
      isAssemblyProcedurePointInCrop(
        { xRatio: marker.xRatio, yRatio: marker.yRatio },
        step.crop
      ))
  );
}

export function canRemoveProcedureStep(input: {
  steps: AssemblyProcedureStepDraft[];
  localId: string;
  markers: AssemblyProcedureSourceMarker[];
}): { allowed: true } | { allowed: false; message: string } {
  if (input.steps.length <= 1) {
    return { allowed: false, message: '表示ステップは1件以上必要です。' };
  }
  const remaining = input.steps.filter((step) => step.localId !== input.localId);
  const hiddenMarker = input.markers.find(
    (marker) => !remaining.some((step) => isMarkerVisibleInProcedureStep(marker, step))
  );
  return hiddenMarker
    ? {
        allowed: false,
        message: `丸数字／チェック${hiddenMarker.markerNo}が見える最後の表示ステップは削除できません。`
      }
    : { allowed: true };
}

export function findMarkerWithoutVisibleProcedureStep(
  steps: AssemblyProcedureStepDraft[],
  markers: AssemblyProcedureSourceMarker[]
): AssemblyProcedureSourceMarker | null {
  return (
    markers.find(
      (marker) => !steps.some((step) => isMarkerVisibleInProcedureStep(marker, step))
    ) ?? null
  );
}

export function orderProcedureItemsByFirstStep(
  items: AssemblyTemplateProcedureDraftItem[],
  steps: AssemblyProcedureStepDraft[]
): AssemblyTemplateProcedureDraftItem[] {
  const byKey = new Map(items.map((item) => [assemblyProcedureStepDocumentKey(item), item]));
  const orderedKeys = [...new Set(steps.map(assemblyProcedureStepDocumentKey))];
  return orderedKeys.flatMap((key) => {
    const item = byKey.get(key);
    return item ? [item] : [];
  });
}

export function getPrimaryAssemblyDocumentIdFromSteps(
  steps: AssemblyProcedureStepDraft[]
): string | null {
  return (
    steps.find((step) => step.assemblyProcedureDocumentId != null)
      ?.assemblyProcedureDocumentId ?? null
  );
}

export function transformMarkerForProcedureStep<T extends AssemblyProcedureSourceMarker>(
  marker: T,
  step: AssemblyProcedureStepDraft
): T | null {
  if (!isMarkerVisibleInProcedureStep(marker, step)) return null;
  return projectAssemblyProcedureMarkerToCrop(marker, step.crop);
}
