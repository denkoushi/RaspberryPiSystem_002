import { InspectionDrawingPointSettingsPanel } from './InspectionDrawingPointSettingsPanel';
import { InspectionDrawingPointSummaryList } from './InspectionDrawingPointSummaryList';
import { InspectionDrawingValuePanel } from './InspectionDrawingValuePanel';

import type { InspectionDrawingToolbarMode } from './InspectionDrawingCreateToolbar';
import type {
  PartMeasurementDrawingOcrCandidateDto,
  PartMeasurementDrawingOcrStatus
} from '../types';
import type { InspectionDrawingPoint } from './types';
import type { InspectionDrawingMeasurementLabelSetting } from '@raspi-system/shared-types';

type Props = {
  mode: InspectionDrawingToolbarMode;
  points: InspectionDrawingPoint[];
  selectedPoint: InspectionDrawingPoint | null;
  contentReadOnly: boolean;
  onSelectPoint: (pointId: string) => void;
  onPointChange: (patch: Partial<InspectionDrawingPoint>) => void;
  onRemovePoint?: () => void;
  onRemoveAllPoints?: () => void;
  onTestValueChange: (value: string) => void;
  onCommitTestValue?: (payload: {
    pointId: string;
    value: string;
    source: 'dropdown' | 'hundredths_button' | 'enter' | 'blur' | 'blur_without_guide' | 'manual_switch';
  }) => void;
  guidedTrialHint?: string | null;
  onResumeGuidedTrial?: () => void;
  ocrCandidates?: PartMeasurementDrawingOcrCandidateDto[];
  ocrCandidateStatus?: PartMeasurementDrawingOcrStatus | null;
  ocrCandidateLoading?: boolean;
  ocrCandidateError?: string | null;
  onApplyOcrCandidate?: (valueText: string) => void;
  measurementLabelSettings?: readonly InspectionDrawingMeasurementLabelSetting[];
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
  onRemoveAllPoints,
  onTestValueChange,
  onCommitTestValue,
  guidedTrialHint,
  onResumeGuidedTrial,
  ocrCandidates,
  ocrCandidateStatus,
  ocrCandidateLoading,
  ocrCandidateError,
  onApplyOcrCandidate,
  measurementLabelSettings
}: Props) {
  const showHistoryPlaceHint = contentReadOnly && (mode === 'place' || mode === 'callout') && !selectedPoint;
  const showSettings = (mode === 'place' || mode === 'callout') && selectedPoint;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-2">
        {showSettings ? (
          <InspectionDrawingPointSettingsPanel
            point={selectedPoint}
            disabled={contentReadOnly}
            onChange={onPointChange}
            onRemove={onRemovePoint}
            onRemoveAll={onRemoveAllPoints}
            ocrCandidates={ocrCandidates}
            ocrCandidateStatus={ocrCandidateStatus}
            ocrCandidateLoading={ocrCandidateLoading}
            ocrCandidateError={ocrCandidateError}
            onApplyOcrCandidate={onApplyOcrCandidate}
            measurementLabelSettings={measurementLabelSettings}
          />
        ) : null}

        {(mode === 'place' || mode === 'callout') && !selectedPoint && !showHistoryPlaceHint ? (
          <p className="px-1 text-[0.92rem] text-white/55">
            {mode === 'callout'
              ? '測定点を選び、図面上で指差し先端をタップしてください。'
              : '図面上で点を選択するか、一覧から選んでください。'}
          </p>
        ) : null}

        {showHistoryPlaceHint ? (
          <p className="px-1 text-[0.98rem] text-white/55">
            履歴版は表示のみです。点の選択とテスト入力はできます。
          </p>
        ) : null}

        {mode === 'guidedTrial' ? (
          <p className="px-1 text-[0.92rem] text-cyan-100/90">
            ガイド試行のみ（保存されません）。OK の測定値だけ次の No. へ進みます。
          </p>
        ) : null}

        {mode === 'test' || mode === 'guidedTrial' ? (
          <InspectionDrawingValuePanel
            point={selectedPoint}
            readOnly={contentReadOnly}
            onValueChange={onTestValueChange}
            onCommitValue={mode === 'guidedTrial' ? onCommitTestValue : undefined}
          />
        ) : null}

        {mode === 'guidedTrial' && onResumeGuidedTrial ? (
          <button
            type="button"
            className="rounded border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100"
            onClick={onResumeGuidedTrial}
          >
            再開
          </button>
        ) : null}

        {guidedTrialHint ? (
          <p className="px-1 text-[0.85rem] text-cyan-100/80">{guidedTrialHint}</p>
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
