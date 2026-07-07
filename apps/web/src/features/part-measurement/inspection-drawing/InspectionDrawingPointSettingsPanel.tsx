import {
  buildDefaultInspectionDrawingMeasurementLabelSettings,
  buildInspectionDrawingToleranceCandidateValuesForLabel,
  resolveInspectionDrawingGeneralToleranceForNominal,
  resolveInspectionDrawingToleranceKindForLabel,
  type InspectionDrawingMeasurementLabelSetting
} from '@raspi-system/shared-types';
import { useEffect, useState } from 'react';

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

const toleranceCandidateChipClassName =
  'min-h-7 rounded border border-cyan-300/40 bg-cyan-950/70 px-2 text-cyan-50 disabled:opacity-50';

type ToleranceCandidateInputProps = {
  value: string;
  candidateValues: readonly string[];
  disabled: boolean;
  onValueChange: (value: string) => void;
};

function ToleranceCandidateInput({
  value,
  candidateValues,
  disabled,
  onValueChange
}: ToleranceCandidateInputProps) {
  const [draftValue, setDraftValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  const showCandidates = isFocused && !disabled;

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        value={draftValue}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(event) => {
          setDraftValue(event.target.value);
          onValueChange(event.target.value);
        }}
        className={inspectionDrawingPointSettingInputClassName}
        disabled={disabled}
      />
      {showCandidates ? (
        <div
          className="absolute left-0 right-0 top-full z-10 mt-1 flex min-h-8 flex-wrap items-center gap-1 rounded border border-cyan-300/20 bg-slate-950/95 p-1 text-[0.8rem] font-semibold shadow-md"
          role="listbox"
          aria-label="公差候補"
        >
          {candidateValues.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="option"
              disabled={disabled}
              className={toleranceCandidateChipClassName}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                setDraftValue(candidate);
                onValueChange(candidate);
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  const effectiveMeasurementLabelSettings =
    measurementLabelSettings && measurementLabelSettings.length > 0
      ? measurementLabelSettings
      : DEFAULT_MEASUREMENT_LABEL_SETTINGS;
  const labelOptions = buildMeasurementLabelSelectOptions(point.name, effectiveMeasurementLabelSettings);
  const toleranceKind = resolveInspectionDrawingToleranceKindForLabel(
    point.name,
    effectiveMeasurementLabelSettings
  );
  const toleranceCandidateValues = buildInspectionDrawingToleranceCandidateValuesForLabel(
    point.name,
    effectiveMeasurementLabelSettings
  );
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
            onBlur={() => {
              if (toleranceKind !== 'dimension') {
                return;
              }
              if (point.upperToleranceRaw.trim() !== '' || point.lowerToleranceRaw.trim() !== '') {
                return;
              }
              const nominal = Number(point.nominalRaw.trim().replace(/,/g, ''));
              if (!Number.isFinite(nominal)) {
                return;
              }
              const generalTolerance = resolveInspectionDrawingGeneralToleranceForNominal(nominal);
              if (generalTolerance === null) {
                return;
              }
              onChange({
                upperToleranceRaw: `+${generalTolerance}`,
                lowerToleranceRaw: `-${generalTolerance}`
              });
            }}
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
                  className={toleranceCandidateChipClassName}
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
        <label className="grid gap-1 text-[1rem] font-semibold">
          上限公差
          <ToleranceCandidateInput
            value={point.upperToleranceRaw}
            candidateValues={toleranceCandidateValues}
            onValueChange={(value) => onChange({ upperToleranceRaw: value })}
            disabled={disabled}
          />
        </label>
        <label className="grid gap-1 text-[1rem] font-semibold">
          下限公差
          <ToleranceCandidateInput
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
