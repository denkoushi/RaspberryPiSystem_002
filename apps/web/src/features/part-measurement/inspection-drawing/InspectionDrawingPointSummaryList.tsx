import { isInspectionDrawingThroughDepthMode } from '@raspi-system/shared-types';
import clsx from 'clsx';

import { inspectionDrawingPointHasCalloutTip } from './inspectionDrawingCalloutTip';
import {
  inspectionDrawingPointSummaryListSidebarCardClassName,
  inspectionDrawingPointSummaryListSidebarCardSelectedClassName,
  inspectionDrawingPointSummaryListSidebarClassName,
  inspectionDrawingPointSummaryListSidebarSectionClassName,
  inspectionDrawingPointSummaryListSidebarTitleClassName,
  inspectionDrawingPointSummaryListSidebarTwoColumnClassName
} from './inspectionDrawingKioskUi';
import {
  MEASUREMENT_POINT_INPUT_STATUS_LABEL,
  resolveMeasurementPointInputStatus
} from './measurementPointInputStatus';
import { formatInspectionDrawingPointDisplayName } from './measurementPointSupplement';

import type { InspectionDrawingPoint } from './types';

export type InspectionDrawingPointSummaryListLayout = 'oneColumn' | 'twoColumn';

type Props = {
  points: InspectionDrawingPoint[];
  selectedPointId: string | null;
  disabled?: boolean;
  onSelectPoint: (pointId: string) => void;
  /** 一覧タップ前に blur ガイド進行を抑止する（自主検査セッション向け） */
  onSelectPointerDownCapture?: () => void;
  /** 入力値と OK/NG 等の状態を表示（自主検査セッション向け・opt-in） */
  showMeasurementStatus?: boolean;
  variant: 'sidebar';
  /** 列数。自主検査セッション右ペインのみ twoColumn、作成/改版は oneColumn（既定） */
  layout?: InspectionDrawingPointSummaryListLayout;
};

function sortByMarkerNo(points: InspectionDrawingPoint[]): InspectionDrawingPoint[] {
  return [...points].sort((a, b) => a.markerNo - b.markerNo);
}

function displayRaw(raw: string): string {
  const t = raw.trim();
  if (t === 'PASS') return 'OK';
  if (t === 'FAIL') return 'NG';
  return t.length > 0 ? t : '—';
}

const STATUS_CLASS: Record<string, string> = {
  empty: 'text-slate-400',
  ok: 'text-emerald-400',
  ng: 'text-red-400',
  tolerance_error: 'text-amber-300',
  invalid: 'text-amber-300'
};

/** 測定点一覧 — 右ペイン縦スクロール・2行カード */
export function InspectionDrawingPointSummaryList({
  points,
  selectedPointId,
  disabled = false,
  onSelectPoint,
  onSelectPointerDownCapture,
  showMeasurementStatus = false,
  variant,
  layout = 'oneColumn'
}: Props) {
  if (variant !== 'sidebar') {
    return null;
  }

  const sorted = sortByMarkerNo(points);
  const listClassName =
    layout === 'twoColumn'
      ? inspectionDrawingPointSummaryListSidebarTwoColumnClassName
      : inspectionDrawingPointSummaryListSidebarClassName;

  return (
    <div
      className={inspectionDrawingPointSummaryListSidebarSectionClassName}
      data-self-inspection-point-summary-list
    >
      <p className={inspectionDrawingPointSummaryListSidebarTitleClassName}>測定点一覧</p>
      {sorted.length === 0 ? (
        <p className="px-1 text-[0.92rem] text-white/50">測定点がありません。図面上で点を置いてください。</p>
      ) : (
        <div className={listClassName} role="list" aria-label="測定点一覧">
          {sorted.map((pt) => {
            const selected = pt.id === selectedPointId;
            const displayName = formatInspectionDrawingPointDisplayName(pt, '（名称未選択）');
            const inputStatus = showMeasurementStatus ? resolveMeasurementPointInputStatus(pt) : null;
            const testValueDisplay = showMeasurementStatus ? displayRaw(pt.testValue) : null;
            return (
              <div key={pt.id} role="listitem" className="min-w-0">
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`測定点 No.${pt.markerNo} ${displayName} を選択`}
                  className={clsx(
                    inspectionDrawingPointSummaryListSidebarCardClassName,
                    selected &&
                      (layout === 'twoColumn'
                        ? inspectionDrawingPointSummaryListSidebarCardSelectedClassName
                        : 'border-cyan-300 bg-cyan-950/40 ring-2 ring-cyan-300/80')
                  )}
                  onPointerDownCapture={onSelectPointerDownCapture}
                  onClick={() => onSelectPoint(pt.id)}
                >
                  <span className="truncate">
                    <span className={clsx('font-bold', selected ? (layout === 'twoColumn' ? 'text-cyan-100' : 'text-cyan-200') : 'text-white/80')}>
                      No.{pt.markerNo}
                    </span>
                    <span className="ml-1 font-semibold">{displayName}</span>
                    {inspectionDrawingPointHasCalloutTip(pt) ? (
                      <span className="ml-1 align-middle text-[0.62rem] font-extrabold text-amber-300">指</span>
                    ) : null}
                  </span>
                  {showMeasurementStatus ? (
                    <span className="flex min-w-0 items-center justify-between gap-2 text-white/75">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-white/50">測定値</span> {testValueDisplay}
                      </span>
                      {inputStatus ? (
                        <span
                          className={clsx(
                            'shrink-0 text-xs font-bold',
                            STATUS_CLASS[inputStatus] ?? 'text-white/60'
                          )}
                        >
                          {MEASUREMENT_POINT_INPUT_STATUS_LABEL[inputStatus]}
                        </span>
                      ) : null}
                    </span>
                  ) : pt.valueKind === 'judgement' ? (
                    <span className="truncate font-semibold text-cyan-100">OK/NG判定</span>
                  ) : isInspectionDrawingThroughDepthMode(pt.depthMode) ? (
                    <span className="truncate font-semibold text-cyan-100">通し</span>
                  ) : (
                    <span className="truncate text-white/75">
                      <span className="text-white/50">基準</span> {displayRaw(pt.nominalRaw)}
                      <span className="mx-1 text-white/30">·</span>
                      <span className="text-white/50">上限</span> {displayRaw(pt.upperToleranceRaw)}
                      <span className="mx-1 text-white/30">·</span>
                      <span className="text-white/50">下限</span> {displayRaw(pt.lowerToleranceRaw)}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
