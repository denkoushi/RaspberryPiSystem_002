import clsx from 'clsx';

import {
  inspectionDrawingPointSummaryListSidebarCardClassName,
  inspectionDrawingPointSummaryListSidebarClassName,
  inspectionDrawingPointSummaryListSidebarSectionClassName,
  inspectionDrawingPointSummaryListSidebarTitleClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingPoint } from './types';

type Props = {
  points: InspectionDrawingPoint[];
  selectedPointId: string | null;
  disabled?: boolean;
  onSelectPoint: (pointId: string) => void;
  variant: 'sidebar';
};

function sortByMarkerNo(points: InspectionDrawingPoint[]): InspectionDrawingPoint[] {
  return [...points].sort((a, b) => a.markerNo - b.markerNo);
}

function displayRaw(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : '—';
}

/** 測定点一覧 — 右ペイン縦スクロール・2行カード */
export function InspectionDrawingPointSummaryList({
  points,
  selectedPointId,
  disabled = false,
  onSelectPoint,
  variant
}: Props) {
  if (variant !== 'sidebar') {
    return null;
  }

  const sorted = sortByMarkerNo(points);

  return (
    <div className={inspectionDrawingPointSummaryListSidebarSectionClassName}>
      <p className={inspectionDrawingPointSummaryListSidebarTitleClassName}>測定点一覧</p>
      {sorted.length === 0 ? (
        <p className="px-1 text-[0.92rem] text-white/50">測定点がありません。図面上で点を置いてください。</p>
      ) : (
        <div
          className={inspectionDrawingPointSummaryListSidebarClassName}
          role="list"
          aria-label="測定点一覧"
        >
          {sorted.map((pt) => {
            const selected = pt.id === selectedPointId;
            const displayName = pt.name.trim() || '（名称未選択）';
            return (
              <div key={pt.id} role="listitem">
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`測定点 No.${pt.markerNo} ${displayName} を選択`}
                  className={clsx(
                    inspectionDrawingPointSummaryListSidebarCardClassName,
                    selected && 'border-cyan-400/80 bg-cyan-950/40 ring-1 ring-cyan-400/50'
                  )}
                  onClick={() => onSelectPoint(pt.id)}
                >
                  <span className="truncate">
                    <span className={clsx('font-bold', selected ? 'text-cyan-200' : 'text-white/80')}>
                      No.{pt.markerNo}
                    </span>
                    <span className="ml-1 font-semibold">{displayName}</span>
                  </span>
                  <span className="truncate text-white/75">
                    <span className="text-white/50">基準</span> {displayRaw(pt.nominalRaw)}
                    <span className="mx-1 text-white/30">·</span>
                    <span className="text-white/50">上限</span> {displayRaw(pt.upperToleranceRaw)}
                    <span className="mx-1 text-white/30">·</span>
                    <span className="text-white/50">下限</span> {displayRaw(pt.lowerToleranceRaw)}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
