import { InspectionDrawingPointSettingsPanel } from './InspectionDrawingPointSettingsPanel';
import { InspectionDrawingPointSummaryList } from './InspectionDrawingPointSummaryList';
import { InspectionDrawingValuePanel } from './InspectionDrawingValuePanel';

import type { InspectionDrawingToolbarMode } from './InspectionDrawingCreateToolbar';
import type { InspectionDrawingPoint } from './types';

type Props = {
  mode: InspectionDrawingToolbarMode;
  points: InspectionDrawingPoint[];
  selectedPoint: InspectionDrawingPoint | null;
  contentReadOnly: boolean;
  onSelectPoint: (pointId: string) => void;
  onPointChange: (patch: Partial<InspectionDrawingPoint>) => void;
  onRemovePoint?: () => void;
  onTestValueChange: (value: string) => void;
};

/** 作成/改版 — 右ペイン（設定 or テスト入力 + 測定点一覧） */
export function InspectionDrawingPointSidebar({
  mode,
  points,
  selectedPoint,
  contentReadOnly,
  onSelectPoint,
  onPointChange,
  onRemovePoint,
  onTestValueChange
}: Props) {
  const showHistoryPlaceHint = contentReadOnly && mode === 'place' && !selectedPoint;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-2">
        {mode === 'place' && selectedPoint ? (
          <InspectionDrawingPointSettingsPanel
            point={selectedPoint}
            disabled={contentReadOnly}
            onChange={onPointChange}
            onRemove={onRemovePoint}
          />
        ) : null}

        {mode === 'place' && !selectedPoint && !showHistoryPlaceHint ? (
          <p className="px-1 text-[0.92rem] text-white/55">
            図面上で点を選択するか、一覧から選んでください。
          </p>
        ) : null}

        {showHistoryPlaceHint ? (
          <p className="px-1 text-[0.98rem] text-white/55">
            履歴版は表示のみです。点の選択とテスト入力はできます。
          </p>
        ) : null}

        {mode === 'test' ? (
          <InspectionDrawingValuePanel
            point={selectedPoint}
            readOnly={contentReadOnly}
            onValueChange={onTestValueChange}
          />
        ) : null}
      </div>

      <InspectionDrawingPointSummaryList
        points={points}
        selectedPointId={selectedPoint?.id ?? null}
        onSelectPoint={onSelectPoint}
        variant="sidebar"
      />
    </div>
  );
}
