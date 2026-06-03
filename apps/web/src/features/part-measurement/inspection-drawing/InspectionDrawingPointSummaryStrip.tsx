import clsx from 'clsx';

import {
  inspectionDrawingPointSummaryCardClassName,
  inspectionDrawingPointSummaryStripClassName
} from './inspectionDrawingKioskUi';

import type { InspectionDrawingPoint } from './types';

type Props = {
  points: InspectionDrawingPoint[];
  selectedPointId: string | null;
  disabled?: boolean;
  onSelectPoint: (pointId: string) => void;
};

function sortByMarkerNo(points: InspectionDrawingPoint[]): InspectionDrawingPoint[] {
  return [...points].sort((a, b) => a.markerNo - b.markerNo);
}

function displayRaw(raw: string): string {
  const t = raw.trim();
  return t.length > 0 ? t : '—';
}

/** 作成/改版画面上辺 — 測定点一覧（横スクロール・丸数字順） */
export function InspectionDrawingPointSummaryStrip({
  points,
  selectedPointId,
  disabled = false,
  onSelectPoint
}: Props) {
  const sorted = sortByMarkerNo(points);

  if (sorted.length === 0) {
    return (
      <p className="px-1 text-[0.92rem] text-white/50">測定点がありません。図面上で点を置いてください。</p>
    );
  }

  return (
    <div className={inspectionDrawingPointSummaryStripClassName} role="list" aria-label="測定点一覧">
      {sorted.map((pt) => {
        const selected = pt.id === selectedPointId;
        return (
          <button
            key={pt.id}
            type="button"
            role="listitem"
            disabled={disabled}
            className={clsx(
              inspectionDrawingPointSummaryCardClassName,
              selected && 'border-cyan-400/80 bg-cyan-950/40 ring-1 ring-cyan-400/50'
            )}
            onClick={() => onSelectPoint(pt.id)}
          >
            <span className="font-bold text-cyan-200">No.{pt.markerNo}</span>
            <span className="truncate font-semibold">{pt.name.trim() || '（名称未選択）'}</span>
            <span className="text-white/75">
              <span className="text-white/50">基準 </span>
              {displayRaw(pt.nominalRaw)}
            </span>
            <span className="text-white/75">
              <span className="text-white/50">下限 </span>
              {displayRaw(pt.lowerToleranceRaw)}
            </span>
            <span className="text-white/75">
              <span className="text-white/50">上限 </span>
              {displayRaw(pt.upperToleranceRaw)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
