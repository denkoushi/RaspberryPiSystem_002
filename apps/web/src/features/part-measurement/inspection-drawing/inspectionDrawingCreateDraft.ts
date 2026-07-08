import { mapTemplateFixedCountToFormString } from '../selfInspectionTemplateForm';

import { templateItemToDrawingPoint } from './templateItemMappers';

import type { InspectionDrawingPoint } from './types';
import type {
  PartMeasurementProcessGroup,
  PartMeasurementTemplateDto,
  PartMeasurementTemplateItemDto,
  SelfInspectionMode
} from '../types';

/** 図面ソースの単一真実源（保存時に参照） */
export type InspectionDrawingVisualSource = 'unselected' | 'upload' | 'pickExisting';

/** 雛形流用の参照元キー（編集 state の template とは分離） */
export type InspectionDrawingSourceTemplateDraft = {
  sourceTemplateId: string;
  sourceFhincd: string;
  sourceProcessGroup: PartMeasurementProcessGroup;
  sourceResourceCd: string;
};

export type InspectionDrawingCreateDraftForm = {
  templateName: string;
  fhincd: string;
  resourceCd: string;
  processGroup: PartMeasurementProcessGroup;
  points: InspectionDrawingPoint[];
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: string;
  visualTemplateId: string | null;
  visualTemplateName: string | null;
  drawingImageRelativePath: string | null;
  sourceDraft: InspectionDrawingSourceTemplateDraft;
};

export type TemplateBusinessKey = {
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
};

export type InspectionDrawingCreateKeyCollision =
  | 'same_as_source'
  | 'active_exists';

export type InspectionDrawingCreateSaveBlockReason =
  | 'content_read_only'
  | 'busy'
  | 'missing_fhincd'
  | 'missing_resource'
  | 'missing_drawing'
  | 'missing_points'
  | 'invalid_points'
  | 'invalid_self_inspection'
  | 'key_collision'
  | 'preview_pending';

export type InspectionDrawingCreateSaveStatus =
  | 'saved'
  | 'dirty'
  | 'blocked'
  | 'saving'
  | 'read_only';

export const INSPECTION_DRAWING_CREATE_SAVE_STATUS_LABEL: Record<
  InspectionDrawingCreateSaveStatus,
  string
> = {
  saved: '保存済み',
  dirty: '未保存あり',
  blocked: '入力不足',
  saving: '保存中',
  read_only: '閲覧のみ'
};

export type InspectionDrawingCreateDirtySnapshot = {
  templateName: string;
  fhincd: string;
  resourceCds: string[];
  processGroup: PartMeasurementProcessGroup;
  visualSource: InspectionDrawingVisualSource;
  visualTemplateId: string | null;
  uploadPending: boolean;
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: string;
  groupSaveMode: 'group' | 'single';
  points: Array<{
    markerNo: number;
    name: string;
    threadNominal: string;
    surfaceSide: string;
    supplementText: string;
    xRatio: number;
    yRatio: number;
    nominalRaw: string;
    lowerToleranceRaw: string;
    upperToleranceRaw: string;
    decimalPlaces: number | null;
    legacyAbsoluteBounds: { lowerLimit: number; upperLimit: number } | null;
  }>;
};

/** API の normalizeFhincd と同じ（trim + 大文字化） */
export function normalizeFhincdForTemplateKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function normalizeUniqueInspectionDrawingResourceCds(raw: string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values.sort((a, b) => a.localeCompare(b, 'ja'));
}

function normalizeNullableId(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  return value ? value : null;
}

function normalizeText(raw: string): string {
  return raw.trim();
}

function normalizeRatio(raw: number): number {
  return Math.round(raw * 1_000_000) / 1_000_000;
}

export function buildInspectionDrawingCreateDirtySnapshot(params: {
  templateName: string;
  fhincd: string;
  resourceCds: string[];
  processGroup: PartMeasurementProcessGroup;
  visualSource: InspectionDrawingVisualSource;
  visualTemplateId: string | null | undefined;
  uploadPending: boolean;
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount: string;
  groupSaveMode: 'group' | 'single';
  points: readonly InspectionDrawingPoint[];
}): InspectionDrawingCreateDirtySnapshot {
  return {
    templateName: normalizeText(params.templateName),
    fhincd: normalizeFhincdForTemplateKey(params.fhincd),
    resourceCds: normalizeUniqueInspectionDrawingResourceCds(params.resourceCds),
    processGroup: params.processGroup,
    visualSource: params.visualSource,
    visualTemplateId: normalizeNullableId(params.visualTemplateId),
    uploadPending: params.uploadPending,
    selfInspectionMode: params.selfInspectionMode,
    selfInspectionFixedCount: normalizeText(params.selfInspectionFixedCount),
    groupSaveMode: params.groupSaveMode,
    points: params.points.map((pt) => ({
      markerNo: pt.markerNo,
      name: normalizeText(pt.name),
      threadNominal: normalizeText(pt.threadNominal ?? ''),
      surfaceSide: normalizeText(pt.surfaceSide ?? ''),
      supplementText: normalizeText(pt.supplementText ?? ''),
      xRatio: normalizeRatio(pt.xRatio),
      yRatio: normalizeRatio(pt.yRatio),
      nominalRaw: normalizeText(pt.nominalRaw),
      lowerToleranceRaw: normalizeText(pt.lowerToleranceRaw),
      upperToleranceRaw: normalizeText(pt.upperToleranceRaw),
      decimalPlaces: pt.decimalPlaces ?? null,
      legacyAbsoluteBounds: pt.legacyAbsoluteBounds
        ? {
            lowerLimit: normalizeRatio(pt.legacyAbsoluteBounds.lowerLimit),
            upperLimit: normalizeRatio(pt.legacyAbsoluteBounds.upperLimit)
          }
        : null
    }))
  };
}

export function inspectionDrawingCreateDirtySnapshotsEqual(
  a: InspectionDrawingCreateDirtySnapshot | null,
  b: InspectionDrawingCreateDirtySnapshot | null
): boolean {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function resolveInspectionDrawingCreateSaveStatus(params: {
  contentReadOnly: boolean;
  busy: boolean;
  saveBlockReason: InspectionDrawingCreateSaveBlockReason | null;
  dirty: boolean;
}): InspectionDrawingCreateSaveStatus {
  if (params.contentReadOnly) return 'read_only';
  if (params.busy) return 'saving';
  if (params.saveBlockReason) return 'blocked';
  return params.dirty ? 'dirty' : 'saved';
}

export function suggestInspectionDrawingTemplateName(params: {
  visualTemplateName: string | null | undefined;
  fhincd: string;
}): string {
  const visualName = params.visualTemplateName?.trim() ?? '';
  const fhincd = params.fhincd.trim();
  if (visualName && fhincd) return `${visualName} ${fhincd}`.slice(0, 200);
  if (visualName) return visualName.slice(0, 200);
  if (fhincd) return `検査図面 ${fhincd}`.slice(0, 200);
  return '';
}

export function normalizeTemplateBusinessKey(key: TemplateBusinessKey): TemplateBusinessKey {
  return {
    fhincd: normalizeFhincdForTemplateKey(key.fhincd),
    processGroup: key.processGroup,
    resourceCd: key.resourceCd.trim()
  };
}

export function templateBusinessKeysEqual(a: TemplateBusinessKey, b: TemplateBusinessKey): boolean {
  const left = normalizeTemplateBusinessKey(a);
  const right = normalizeTemplateBusinessKey(b);
  return (
    left.fhincd === right.fhincd &&
    left.processGroup === right.processGroup &&
    left.resourceCd === right.resourceCd
  );
}

/** 雛形用: item id を編集 state と混ぜず、新規 point id を採番する */
export function templateItemsToDraftDrawingPoints(
  items: PartMeasurementTemplateItemDto[]
): InspectionDrawingPoint[] {
  return items.map((item) => {
    const point = templateItemToDrawingPoint(item);
    return { ...point, id: crypto.randomUUID() };
  });
}

/**
 * 有効版テンプレから新規作成フォーム初期値へ変換（編集用 applyLoadedTemplate とは別責務）。
 */
export function templateToCreateDraft(template: PartMeasurementTemplateDto): InspectionDrawingCreateDraftForm {
  const processGroup: PartMeasurementProcessGroup =
    template.processGroup === 'grinding' ? 'grinding' : 'cutting';

  return {
    templateName: template.name,
    fhincd: template.fhincd,
    resourceCd: template.resourceCd,
    processGroup,
    points: templateItemsToDraftDrawingPoints(template.items),
    selfInspectionMode: template.selfInspectionMode,
    selfInspectionFixedCount: mapTemplateFixedCountToFormString(
      template.selfInspectionMode,
      template.selfInspectionFixedCount,
      template.selfInspectionSampleSize
    ),
    visualTemplateId: template.visualTemplateId?.trim() || null,
    visualTemplateName: template.visualTemplate?.name ?? null,
    drawingImageRelativePath: template.visualTemplate?.drawingImageRelativePath ?? null,
    sourceDraft: {
      sourceTemplateId: template.id,
      sourceFhincd: template.fhincd,
      sourceProcessGroup: processGroup,
      sourceResourceCd: template.resourceCd
    }
  };
}

export function resolveInspectionDrawingCreateKeyCollision(params: {
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  sourceDraft: InspectionDrawingSourceTemplateDraft | null;
  activeExists: boolean;
}): InspectionDrawingCreateKeyCollision | null {
  const key = normalizeTemplateBusinessKey({
    fhincd: params.fhincd,
    processGroup: params.processGroup,
    resourceCd: params.resourceCd
  });

  if (params.sourceDraft) {
    const sourceKey = normalizeTemplateBusinessKey({
      fhincd: params.sourceDraft.sourceFhincd,
      processGroup: params.sourceDraft.sourceProcessGroup,
      resourceCd: params.sourceDraft.sourceResourceCd
    });
    if (templateBusinessKeysEqual(key, sourceKey)) {
      return 'same_as_source';
    }
  }

  if (params.activeExists) {
    return 'active_exists';
  }

  return null;
}

export function resolveInspectionDrawingCreateKeyCollisionForResources(params: {
  fhincd: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCds: string[];
  sourceDraft: InspectionDrawingSourceTemplateDraft | null;
  activeExistsByResourceCd: Record<string, boolean>;
}): InspectionDrawingCreateKeyCollision | null {
  for (const resourceCd of params.resourceCds) {
    const collision = resolveInspectionDrawingCreateKeyCollision({
      fhincd: params.fhincd,
      processGroup: params.processGroup,
      resourceCd,
      sourceDraft: params.sourceDraft,
      activeExists: params.activeExistsByResourceCd[resourceCd] === true
    });
    if (collision) return collision;
  }
  return null;
}

export function resolveInspectionDrawingCreateSaveBlockReason(params: {
  contentReadOnly: boolean;
  busy: boolean;
  fhincd: string;
  resourceCds: string[];
  hasDrawing: boolean;
  pointCount: number;
  pointsValid: boolean;
  selfInspectionValid: boolean;
  keyCollision: InspectionDrawingCreateKeyCollision | null;
  saveBlockedByPreview: boolean;
}): InspectionDrawingCreateSaveBlockReason | null {
  if (params.contentReadOnly) return 'content_read_only';
  if (params.busy) return 'busy';
  if (!params.fhincd.trim()) return 'missing_fhincd';
  if (params.resourceCds.length === 0) return 'missing_resource';
  if (!params.hasDrawing) return 'missing_drawing';
  if (params.pointCount === 0) return 'missing_points';
  if (!params.pointsValid) return 'invalid_points';
  if (!params.selfInspectionValid) return 'invalid_self_inspection';
  if (params.keyCollision) return 'key_collision';
  if (params.saveBlockedByPreview) return 'preview_pending';
  return null;
}

export function inspectionDrawingCreateKeyCollisionMessage(
  reason: InspectionDrawingCreateKeyCollision
): string {
  if (reason === 'same_as_source') {
    return '流用元と同じ品番・工程・資源CDです。工程または資源CDを変更してください。';
  }
  return '同一品番・工程・資源CDの有効テンプレートが既にあります。改版する場合は一覧から編集してください。';
}
