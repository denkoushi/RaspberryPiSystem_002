import clsx from 'clsx';

import { Button } from '../../components/ui/Button';

import { InspectionDrawingCanvasZoomControls } from './inspection-drawing/InspectionDrawingCanvasZoomControls';
import {
  inspectionDrawingKioskToggleInactiveClass,
  selfInspectionSessionFlatBandClassName,
  selfInspectionSessionMetaChipClassName,
  selfInspectionSessionMetaRowClassName,
  selfInspectionSessionToolbarSlotClassName
} from './inspection-drawing/inspectionDrawingKioskUi';

import type { SelfInspectionGuideMode } from './selfInspectionGuidedFocus';

type Props = {
  productNo: string;
  fhincd: string;
  resourceCd: string;
  fhinmei: string;
  modeLabel: string;
  requiredEntryCount: number;
  entryCountBlockedReason: string | null;
  guideMode: SelfInspectionGuideMode;
  guideActionsEnabled: boolean;
  zoomEnabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;
  onResumeGuide: () => void;
  onNextPoint: () => void;
  /** 次の blur 1 回だけガイド進行を抑止（pointer/touch の実行直前。Tab の onFocus では立てない） */
  onPrepareNextPoint?: () => void;
  onBackToList: () => void;
  onReset?: () => void;
  resetDisabled?: boolean;
};

export function SelfInspectionSessionHeader({
  productNo,
  fhincd,
  resourceCd,
  fhinmei,
  modeLabel,
  requiredEntryCount,
  entryCountBlockedReason,
  guideMode,
  guideActionsEnabled,
  zoomEnabled,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResumeGuide,
  onNextPoint,
  onPrepareNextPoint,
  onBackToList,
  onReset,
  resetDisabled = false
}: Props) {
  return (
    <div data-testid="self-inspection-session-header-band" className={selfInspectionSessionFlatBandClassName}>
      <div className={selfInspectionSessionMetaRowClassName}>
        <span className={clsx(selfInspectionSessionMetaChipClassName, 'font-bold text-white')}>
          {productNo}
        </span>
        <span className={selfInspectionSessionMetaChipClassName}>
          {fhincd} / {resourceCd}
        </span>
        <span className={clsx(selfInspectionSessionMetaChipClassName, 'max-w-[14rem] truncate')} title={fhinmei}>
          {fhinmei}
        </span>
        <span className={selfInspectionSessionMetaChipClassName}>
          {modeLabel} / 必要 {requiredEntryCount} 件
        </span>
        {entryCountBlockedReason ? (
          <span className="shrink-0 text-[0.75rem] text-amber-200">{entryCountBlockedReason}</span>
        ) : null}
        <span
          className={clsx(
            'shrink-0 rounded border px-1.5 py-0.5 text-[0.7rem] font-semibold',
            guideMode === 'guided'
              ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
              : 'border-white/20 bg-white/5 text-white/55'
          )}
        >
          {guideMode === 'guided' ? 'ガイド' : '手動'}
        </span>
      </div>
      <div className={selfInspectionSessionToolbarSlotClassName} data-self-inspection-session-toolbar>
        <InspectionDrawingCanvasZoomControls
          enabled={zoomEnabled}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFitToView={onFitToView}
        />
        <Button
          type="button"
          variant="ghostOnDark"
          className={clsx('min-h-11 px-2 text-sm', inspectionDrawingKioskToggleInactiveClass(guideMode === 'guided'))}
          disabled={!zoomEnabled || !guideActionsEnabled}
          onClick={onResumeGuide}
        >
          再開
        </Button>
        <Button
          type="button"
          variant="ghostOnDark"
          className="min-h-11 px-2 text-sm"
          onPointerDownCapture={() => onPrepareNextPoint?.()}
          onPointerDown={() => onPrepareNextPoint?.()}
          onTouchStart={() => onPrepareNextPoint?.()}
          onClick={onNextPoint}
        >
          次の測定点
        </Button>
        {onReset ? (
          <Button
            type="button"
            variant="ghostOnDark"
            className="min-h-11 px-2 text-sm text-amber-100"
            disabled={resetDisabled}
            onClick={onReset}
          >
            初期化
          </Button>
        ) : null}
        <Button type="button" variant="ghostOnDark" className="min-h-11 px-2 text-sm" onClick={onBackToList}>
          一覧へ
        </Button>
      </div>
    </div>
  );
}
