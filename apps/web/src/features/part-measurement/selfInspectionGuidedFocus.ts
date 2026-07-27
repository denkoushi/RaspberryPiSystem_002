import { resolveInspectionDrawingZoomFromDefaultSteps } from './inspection-drawing/inspectionDrawingZoom';
import { templateItemToDrawingPoint } from './inspection-drawing/markerNumbering';
import {
  resolveMeasurementPointInputStatus,
  type MeasurementPointInputStatus
} from './inspection-drawing/measurementPointInputStatus';

import type { InspectionDrawingPoint } from './inspection-drawing/types';
import type { PartMeasurementTemplateItemDto, SelfInspectionSessionDetailDto } from './types';

export type SelfInspectionGuideMode = 'guided' | 'manual';

export type SelfInspectionValueCommitSource =
  | 'dropdown'
  | 'hundredths_button'
  | 'enter'
  | 'blur'
  /** セッションツールバーへフォーカス移動時の blur（ガイド自動進行なし） */
  | 'blur_without_guide'
  | 'manual_switch';

export type SelfInspectionValueCommitPayload = {
  pointId: string;
  entryIndex: number;
  value: string;
  source: SelfInspectionValueCommitSource;
  outOfToleranceConfirmed?: boolean;
};

export type SelfInspectionPointInputStatus = MeasurementPointInputStatus;

export type SelfInspectionGuidedFocusRequest = {
  pointId: string;
  requestId: number;
  /** センタリング時に canvas の zoom と layout が一致してから適用する */
  zoom: number;
};

export type SelfInspectionGuidedFocusTarget = {
  pointId: string;
  zoom: number;
  focusRequest: SelfInspectionGuidedFocusRequest;
};

export type SelfInspectionGuidedCommitResult =
  | {
      kind: 'stay';
      pointId: string;
      draft: Record<string, string>;
      inputStatus: SelfInspectionPointInputStatus;
    }
  | {
      kind: 'advance';
      pointId: string;
      draft: Record<string, string>;
      next: SelfInspectionGuidedFocusTarget | null;
    };

/** 旧ガイド相当: fit から 2 段（1.0 + 2×0.25 = 1.5） */
const SELF_INSPECTION_GUIDED_ZOOM_BASE_STEPS_FROM_FIT = 2;
/** 仕様追加: 旧 1.5 から UI「＋」2 段（+0.5 → 2.0） */
const SELF_INSPECTION_GUIDED_ZOOM_EXTRA_STEPS = 2;

/**
 * 自主検査ガイドの拡大段数（fit 基準からの合計 step 数）。
 * 内訳: BASE {@link SELF_INSPECTION_GUIDED_ZOOM_BASE_STEPS_FROM_FIT} + EXTRA {@link SELF_INSPECTION_GUIDED_ZOOM_EXTRA_STEPS} → 4 段 = **2.0** 倍。
 */
export const SELF_INSPECTION_GUIDED_ZOOM_STEPS =
  SELF_INSPECTION_GUIDED_ZOOM_BASE_STEPS_FROM_FIT + SELF_INSPECTION_GUIDED_ZOOM_EXTRA_STEPS;

export function resolveSelfInspectionGuidedZoom(): number {
  return resolveInspectionDrawingZoomFromDefaultSteps(SELF_INSPECTION_GUIDED_ZOOM_STEPS);
}

/** 自主検査ガイドのセンタリング倍率（{@link resolveSelfInspectionGuidedZoom} の結果をキャッシュ） */
export const SELF_INSPECTION_GUIDED_ZOOM = resolveSelfInspectionGuidedZoom();

export function canStartSelfInspectionGuidedFocus(input: {
  isSessionReadOnly: boolean;
  isDrawingCanvasReady: boolean;
  points: InspectionDrawingPoint[];
}): boolean {
  if (input.isSessionReadOnly) return false;
  if (!input.isDrawingCanvasReady) return false;
  return input.points.length > 0;
}

export function sortPointsByMarkerNoStable(
  points: InspectionDrawingPoint[],
  templateItems: PartMeasurementTemplateItemDto[]
): InspectionDrawingPoint[] {
  const sortOrderById = new Map(templateItems.map((item) => [item.id, item.sortOrder]));
  return [...points].sort((a, b) => {
    if (a.markerNo !== b.markerNo) return a.markerNo - b.markerNo;
    const orderA = sortOrderById.get(a.id) ?? 0;
    const orderB = sortOrderById.get(b.id) ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.id.localeCompare(b.id);
  });
}

export function buildEntryDrawingPoints(
  session: SelfInspectionSessionDetailDto,
  draft: Record<string, string>
): InspectionDrawingPoint[] {
  return session.template.items.map((item) => templateItemToDrawingPoint(item, draft[item.id] ?? ''));
}

export function resolvePointInputStatus(point: InspectionDrawingPoint): SelfInspectionPointInputStatus {
  return resolveMeasurementPointInputStatus(point);
}

export function isPointInputComplete(
  point: InspectionDrawingPoint,
  outOfToleranceAcknowledgedByPointId: Record<string, boolean> = {}
): boolean {
  const status = resolvePointInputStatus(point);
  return (
    status === 'ok' ||
    (status === 'ng' &&
      (point.valueKind === 'judgement' || outOfToleranceAcknowledgedByPointId[point.id] === true))
  );
}

export function isPointCommitEligible(
  status: SelfInspectionPointInputStatus,
  outOfToleranceConfirmed = false
): boolean {
  return status === 'ok' || (status === 'ng' && outOfToleranceConfirmed);
}

export function shouldAdvanceGuideOnCommit(source: SelfInspectionValueCommitSource): boolean {
  return source === 'dropdown' || source === 'hundredths_button' || source === 'enter' || source === 'blur';
}

/** 丸数字順で最初の未完了測定点（全点 OK なら null）。再開・ガイド遷移用。 */
export function findFirstPendingPointId(
  points: InspectionDrawingPoint[],
  templateItems: PartMeasurementTemplateItemDto[],
  outOfToleranceAcknowledgedByPointId: Record<string, boolean> = {}
): string | null {
  const sorted = sortPointsByMarkerNoStable(points, templateItems);
  return sorted.find((pt) => !isPointInputComplete(pt, outOfToleranceAcknowledgedByPointId))?.id ?? null;
}

/** @deprecated 名称互換。初回開始も {@link findFirstPendingPointId} と同じ（全点空なら No.1 が最小未完了になる）。 */
export function findFirstGuidedPointId(
  points: InspectionDrawingPoint[],
  templateItems: PartMeasurementTemplateItemDto[],
  outOfToleranceAcknowledgedByPointId: Record<string, boolean> = {}
): string | null {
  return findFirstPendingPointId(points, templateItems, outOfToleranceAcknowledgedByPointId);
}

export function findNextGuidedPointIdAfter(
  points: InspectionDrawingPoint[],
  templateItems: PartMeasurementTemplateItemDto[],
  afterPointId: string,
  outOfToleranceAcknowledgedByPointId: Record<string, boolean> = {}
): string | null {
  const sorted = sortPointsByMarkerNoStable(points, templateItems);
  const afterIndex = sorted.findIndex((pt) => pt.id === afterPointId);
  if (afterIndex < 0) {
    return findFirstPendingPointId(points, templateItems, outOfToleranceAcknowledgedByPointId);
  }

  for (let i = afterIndex + 1; i < sorted.length; i += 1) {
    if (!isPointInputComplete(sorted[i]!, outOfToleranceAcknowledgedByPointId)) {
      return sorted[i]!.id;
    }
  }
  return null;
}

/** 丸数字順の次の測定点（末尾の次は先頭）。手動「次の測定点」用。 */
export function findNextPointIdInMarkerOrder(
  points: InspectionDrawingPoint[],
  templateItems: PartMeasurementTemplateItemDto[],
  afterPointId: string | null
): string | null {
  const sorted = sortPointsByMarkerNoStable(points, templateItems);
  if (sorted.length === 0) return null;
  if (!afterPointId) return sorted[0]!.id;
  const afterIndex = sorted.findIndex((pt) => pt.id === afterPointId);
  const nextIndex = afterIndex < 0 ? 0 : (afterIndex + 1) % sorted.length;
  return sorted[nextIndex]!.id;
}

export function createGuidedFocusTarget(
  pointId: string,
  requestId: number,
  zoom = SELF_INSPECTION_GUIDED_ZOOM
): SelfInspectionGuidedFocusTarget {
  return {
    pointId,
    zoom,
    focusRequest: { pointId, requestId, zoom }
  };
}

export function applySelfInspectionGuidedCommit(input: {
  session: SelfInspectionSessionDetailDto;
  entryIndex: number;
  currentDraft: Record<string, string>;
  commit: SelfInspectionValueCommitPayload;
  nextFocusRequestId: number;
  outOfToleranceAcknowledgedByPointId?: Record<string, boolean>;
}): SelfInspectionGuidedCommitResult {
  const nextDraft = {
    ...input.currentDraft,
    [input.commit.pointId]: input.commit.value
  };
  const points = buildEntryDrawingPoints(input.session, nextDraft);
  const committedPoint = points.find((pt) => pt.id === input.commit.pointId);
  if (!committedPoint) {
    return {
      kind: 'stay',
      pointId: input.commit.pointId,
      draft: nextDraft,
      inputStatus: 'invalid'
    };
  }

  const inputStatus = resolvePointInputStatus(committedPoint);
  if (
    !shouldAdvanceGuideOnCommit(input.commit.source) ||
    !isPointCommitEligible(
      inputStatus,
      committedPoint.valueKind === 'judgement' || input.commit.outOfToleranceConfirmed === true
    )
  ) {
    return {
      kind: 'stay',
      pointId: input.commit.pointId,
      draft: nextDraft,
      inputStatus
    };
  }

  const acknowledgedByPointId = {
    ...(input.outOfToleranceAcknowledgedByPointId ?? {}),
    ...(input.commit.outOfToleranceConfirmed === true ? { [input.commit.pointId]: true } : {})
  };
  const nextPointId = findNextGuidedPointIdAfter(
    points,
    input.session.template.items,
    input.commit.pointId,
    acknowledgedByPointId
  );
  if (!nextPointId) {
    return {
      kind: 'advance',
      pointId: input.commit.pointId,
      draft: nextDraft,
      next: null
    };
  }

  return {
    kind: 'advance',
    pointId: input.commit.pointId,
    draft: nextDraft,
    next: createGuidedFocusTarget(nextPointId, input.nextFocusRequestId)
  };
}

export function resolveResumeGuidedFocusTarget(input: {
  session: SelfInspectionSessionDetailDto;
  draft: Record<string, string>;
  requestId: number;
  outOfToleranceAcknowledgedByPointId?: Record<string, boolean>;
}): SelfInspectionGuidedFocusTarget | null {
  const points = buildEntryDrawingPoints(input.session, input.draft);
  const pointId = findFirstPendingPointId(
    points,
    input.session.template.items,
    input.outOfToleranceAcknowledgedByPointId
  );
  if (!pointId) return null;
  return createGuidedFocusTarget(pointId, input.requestId);
}
