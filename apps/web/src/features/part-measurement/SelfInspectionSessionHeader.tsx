import clsx from 'clsx';

import { InspectionDrawingCanvasZoomControls } from './inspection-drawing/InspectionDrawingCanvasZoomControls';
import {
  selfInspectionSessionFlatBandClassName,
  selfInspectionSessionMetaChipClassName,
  selfInspectionSessionMetaRowClassName,
  selfInspectionSessionToolbarSlotClassName
} from './inspection-drawing/inspectionDrawingKioskUi';
import { SelfInspectionKioskButton } from './SelfInspectionKioskButton';
import { selfInspectionKioskButtonClass } from './selfInspectionKioskTheme';

import type { SelfInspectionGuideMode } from './selfInspectionGuidedFocus';
import type { SelfInspectionSessionNotice } from './selfInspectionSessionNotice';

type Props = {
  productNo: string;
  fhincd: string;
  resourceCd: string;
  fhinmei: string;
  modeLabel: string;
  requiredEntryCount: number;
  entryCountBlockedReason: string | null;
  actorLabel: '測定者' | '検査員';
  actorDisplayName?: string | null;
  notice?: SelfInspectionSessionNotice | null;
  guideMode: SelfInspectionGuideMode;
  guideActionsEnabled: boolean;
  canResumeGuide: boolean;
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
  workbenchCameraEnabled?: boolean;
  onToggleWorkbenchCamera?: () => void;
};

export function SelfInspectionSessionHeader({
  productNo,
  fhincd,
  resourceCd,
  fhinmei,
  modeLabel,
  requiredEntryCount,
  entryCountBlockedReason,
  actorLabel,
  actorDisplayName = null,
  notice = null,
  guideMode,
  guideActionsEnabled,
  canResumeGuide,
  zoomEnabled,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResumeGuide,
  onNextPoint,
  onPrepareNextPoint,
  onBackToList,
  onReset,
  resetDisabled = false,
  workbenchCameraEnabled = false,
  onToggleWorkbenchCamera
}: Props) {
  const resumeDisabled = !zoomEnabled || !guideActionsEnabled || !canResumeGuide;

  return (
    <div data-testid="self-inspection-session-header-band" className={selfInspectionSessionFlatBandClassName}>
      <div className={selfInspectionSessionMetaRowClassName}>
        <div className="grid min-w-0 max-w-[19rem] shrink grid-rows-2 text-sm font-bold leading-tight text-white">
          <span className="truncate" title={`製造order: ${productNo}`}>製造order: {productNo || '—'}</span>
          <span className="truncate" title={`FHINCD: ${fhincd}`}>FHINCD: {fhincd || '—'}</span>
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-hidden 2xl:flex">
          <span className={selfInspectionSessionMetaChipClassName} title={`資源CD: ${resourceCd}`}>
            資源CD: {resourceCd || '—'}
          </span>
          <span className={clsx(selfInspectionSessionMetaChipClassName, 'max-w-[11rem]')} title={fhinmei}>
            {fhinmei || '—'}
          </span>
          <span className={selfInspectionSessionMetaChipClassName} title={`${modeLabel} / 必要 ${requiredEntryCount} 件`}>
            {modeLabel} / 必要 {requiredEntryCount} 件
          </span>
          {entryCountBlockedReason ? (
            <span className="min-w-0 truncate text-amber-200" title={entryCountBlockedReason}>{entryCountBlockedReason}</span>
          ) : null}
          <span
            className={clsx(
              'shrink-0 rounded border px-1.5 py-0.5 font-semibold',
              guideMode === 'guided'
                ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                : 'border-white/20 bg-white/5 text-white/55'
            )}
          >
            {guideMode === 'guided' ? 'ガイド' : '手動'}
          </span>
        </div>
      </div>
      <div className="grid h-full min-w-0 grid-rows-2 items-center overflow-hidden px-1 text-xs leading-tight">
        <p className="min-w-0 truncate font-semibold text-cyan-100" title={actorDisplayName ? `現在の${actorLabel}: ${actorDisplayName}` : undefined}>
          {actorDisplayName ? `現在の${actorLabel}: ${actorDisplayName}` : ''}
        </p>
        <p
          aria-live="polite"
          className={clsx(
            'min-w-0 truncate font-semibold',
            notice?.tone === 'red' && 'text-red-200',
            notice?.tone === 'amber' && 'text-amber-200',
            notice?.tone === 'cyan' && 'text-cyan-200',
            notice?.tone === 'neutral' && 'text-white/70'
          )}
          data-testid="self-inspection-session-notice"
          title={notice?.message}
        >
          {notice?.message ?? ''}
        </p>
      </div>
      <div className={selfInspectionSessionToolbarSlotClassName} data-self-inspection-session-toolbar>
        {onToggleWorkbenchCamera ? (
          <SelfInspectionKioskButton
            type="button"
            size="compact"
            tone={workbenchCameraEnabled ? 'default' : 'inactive'}
            aria-pressed={workbenchCameraEnabled}
            onClick={onToggleWorkbenchCamera}
          >
            {workbenchCameraEnabled ? '手元カメラ ON' : '手元カメラ OFF'}
          </SelfInspectionKioskButton>
        ) : null}
        <InspectionDrawingCanvasZoomControls
          enabled={zoomEnabled}
          getButtonClassName={(disabled) =>
            selfInspectionKioskButtonClass({ disabled, size: 'icon' })
          }
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFitToView={onFitToView}
        />
        <SelfInspectionKioskButton
          type="button"
          size="compact"
          disabled={resumeDisabled}
          onClick={onResumeGuide}
        >
          再開
        </SelfInspectionKioskButton>
        <SelfInspectionKioskButton
          type="button"
          size="compact"
          onPointerDownCapture={() => onPrepareNextPoint?.()}
          onPointerDown={() => onPrepareNextPoint?.()}
          onTouchStart={() => onPrepareNextPoint?.()}
          onClick={onNextPoint}
        >
          次の測定点
        </SelfInspectionKioskButton>
        {onReset ? (
          <SelfInspectionKioskButton
            type="button"
            size="compact"
            disabled={resetDisabled}
            onClick={onReset}
          >
            初期化
          </SelfInspectionKioskButton>
        ) : null}
        <SelfInspectionKioskButton type="button" size="compact" onClick={onBackToList}>
          一覧へ
        </SelfInspectionKioskButton>
      </div>
    </div>
  );
}
