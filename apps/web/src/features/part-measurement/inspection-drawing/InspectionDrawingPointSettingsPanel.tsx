import {
  buildDefaultInspectionDrawingMeasurementLabelSettings,
  buildInspectionDrawingToleranceCandidateValues,
  resolveInspectionDrawingToleranceKindForLabel,
  type InspectionDrawingMeasurementLabelSetting
} from '@raspi-system/shared-types';
import { useEffect, useId, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';

import {
  inspectionDrawingBoundedSelectClassName,
  inspectionDrawingBoundedSelectShellClassName,
  inspectionDrawingPointSettingDualCellClassName,
  inspectionDrawingPointSettingDualRowClassName,
  inspectionDrawingPointSettingInputClassName,
  inspectionDrawingPointSettingPanelClassName
} from './inspectionDrawingKioskUi';
import {
  buildMeasurementLabelSelectOptions,
  INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS
} from './inspectionDrawingMeasurementLabelOptions';
import { InspectionDrawingPointPositionNudge } from './InspectionDrawingPointPositionNudge';

import type {
  PartMeasurementDrawingOcrCandidateDto,
  PartMeasurementDrawingOcrStatus
} from '../types';
import type { InspectionDrawingPoint } from './types';

type Props = {
  point: InspectionDrawingPoint;
  disabled?: boolean;
  onChange: (patch: Partial<InspectionDrawingPoint>) => void;
  onRemove?: () => void;
  ocrCandidates?: PartMeasurementDrawingOcrCandidateDto[];
  ocrCandidateStatus?: PartMeasurementDrawingOcrStatus | null;
  ocrCandidateLoading?: boolean;
  ocrCandidateError?: string | null;
  onApplyOcrCandidate?: (valueText: string) => void;
  measurementLabelSettings?: readonly InspectionDrawingMeasurementLabelSetting[];
};

const DEFAULT_MEASUREMENT_LABEL_SETTINGS = buildDefaultInspectionDrawingMeasurementLabelSettings();

type ToleranceCandidateInputProps = {
  listId: string;
  value: string;
  candidateValues: readonly string[];
  disabled: boolean;
  onValueChange: (value: string) => void;
};

function openNativeCandidatePicker(input: HTMLInputElement) {
  const showPicker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
  try {
    showPicker?.call(input);
  } catch {
    // Some browser versions expose showPicker but reject it for text+datalist inputs.
  }
}

function ToleranceCandidateInput({
  listId,
  value,
  candidateValues,
  disabled,
  onValueChange
}: ToleranceCandidateInputProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [shouldRestoreOnBlur, setShouldRestoreOnBlur] = useState(false);

  useEffect(() => {
    setDraftValue(value);
    setShouldRestoreOnBlur(false);
  }, [value]);

  return (
    <Input
      type="text"
      inputMode="decimal"
      list={listId}
      value={draftValue}
      onFocus={(event) => {
        if (disabled || !candidateValues.includes(value)) return;
        event.currentTarget.value = '';
        setDraftValue('');
        setShouldRestoreOnBlur(true);
        openNativeCandidatePicker(event.currentTarget);
      }}
      onBlur={() => {
        if (shouldRestoreOnBlur && draftValue === '') {
          setDraftValue(value);
        }
        setShouldRestoreOnBlur(false);
      }}
      onChange={(event) => {
        setDraftValue(event.target.value);
        setShouldRestoreOnBlur(false);
        onValueChange(event.target.value);
      }}
      className={inspectionDrawingPointSettingInputClassName}
      disabled={disabled}
    />
  );
}

/** 作成/編集画面右欄 — 測定点の名称・基準・公差（本番・開発プレビュー共通） */
export function InspectionDrawingPointSettingsPanel({
  point,
  disabled = false,
  onChange,
  onRemove,
  ocrCandidates = [],
  ocrCandidateStatus = null,
  ocrCandidateLoading = false,
  ocrCandidateError = null,
  onApplyOcrCandidate,
  measurementLabelSettings
}: Props) {
  const toleranceCandidateListId = useId();
  const effectiveMeasurementLabelSettings =
    measurementLabelSettings && measurementLabelSettings.length > 0
      ? measurementLabelSettings
      : DEFAULT_MEASUREMENT_LABEL_SETTINGS;
  const labelOptions = buildMeasurementLabelSelectOptions(point.name, effectiveMeasurementLabelSettings);
  const toleranceKind = resolveInspectionDrawingToleranceKindForLabel(
    point.name,
    effectiveMeasurementLabelSettings
  );
  const toleranceCandidateValues = buildInspectionDrawingToleranceCandidateValues(toleranceKind);
  const showOcrCandidateRow =
    ocrCandidateLoading ||
    ocrCandidateError ||
    ocrCandidates.length > 0 ||
    ocrCandidateStatus === 'failed';

  return (
    <div className={inspectionDrawingPointSettingPanelClassName}>
      <InspectionDrawingPointPositionNudge
        point={point}
        disabled={disabled}
        onChange={onChange}
      />
      <p className="text-[1.02rem] font-bold">測定点の設定（No.{point.markerNo}）</p>
      <div className={inspectionDrawingPointSettingDualRowClassName}>
        <label className={inspectionDrawingPointSettingDualCellClassName}>
          <span className="text-[1rem] font-semibold">名称</span>
          <div className={inspectionDrawingBoundedSelectShellClassName}>
            <select
              value={point.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className={inspectionDrawingBoundedSelectClassName}
              disabled={disabled}
            >
              {labelOptions.map((opt) => (
                <option key={`${opt.value}-${opt.label}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </label>
        <label className={inspectionDrawingPointSettingDualCellClassName}>
          <span className="text-[1rem] font-semibold">基準値</span>
          <Input
            type="text"
            inputMode="decimal"
            value={point.nominalRaw}
            onChange={(e) => onChange({ nominalRaw: e.target.value })}
            className={inspectionDrawingPointSettingInputClassName}
            disabled={disabled}
          />
          {showOcrCandidateRow ? (
            <div className="flex min-h-8 flex-wrap items-center gap-1 text-[0.8rem] font-semibold">
              {ocrCandidateLoading ? <span className="text-cyan-100/75">OCR確認中</span> : null}
              {!ocrCandidateLoading && ocrCandidateStatus === 'failed' ? (
                <span className="text-amber-200">OCR失敗</span>
              ) : null}
              {ocrCandidateError ? <span className="text-amber-200">{ocrCandidateError}</span> : null}
              {ocrCandidates.map((candidate) => (
                <button
                  key={`${candidate.valueText}-${candidate.xRatio}-${candidate.yRatio}`}
                  type="button"
                  disabled={disabled || !onApplyOcrCandidate}
                  className="min-h-7 rounded border border-cyan-300/40 bg-cyan-950/70 px-2 text-cyan-50 disabled:opacity-50"
                  onClick={() => onApplyOcrCandidate?.(candidate.valueText)}
                  title={`raw: ${candidate.rawText}`}
                >
                  {candidate.valueText}
                </button>
              ))}
            </div>
          ) : null}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <datalist id={toleranceCandidateListId}>
          {toleranceCandidateValues.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <label className="grid gap-1 text-[1rem] font-semibold">
          上限公差
          <ToleranceCandidateInput
            listId={toleranceCandidateListId}
            value={point.upperToleranceRaw}
            candidateValues={toleranceCandidateValues}
            onValueChange={(value) => onChange({ upperToleranceRaw: value })}
            disabled={disabled}
          />
        </label>
        <label className="grid gap-1 text-[1rem] font-semibold">
          下限公差
          <ToleranceCandidateInput
            listId={toleranceCandidateListId}
            value={point.lowerToleranceRaw}
            candidateValues={toleranceCandidateValues}
            onValueChange={(value) => onChange({ lowerToleranceRaw: value })}
            disabled={disabled}
          />
        </label>
      </div>
      {onRemove ? (
        <Button type="button" variant="secondary" disabled={disabled} onClick={onRemove}>
          この点を削除
        </Button>
      ) : null}
    </div>
  );
}

/** 将来の管理コンソール連携用（テスト・参照） */
export function getInspectionDrawingMeasurementLabelOptions(): readonly string[] {
  return INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS;
}
