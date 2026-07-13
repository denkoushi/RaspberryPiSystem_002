import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { kioskInputClassName } from '../../../features/kiosk/kioskTheme';

import {
  inspectionDrawingBoundedSelectShellClassName,
  inspectionDrawingMeasurementValueSelectClassName,
  isSelfInspectionSessionChromeFocusTarget
} from './inspectionDrawingKioskUi';
import { formatInspectionDrawingToleranceDisplay } from './inspectionDrawingToleranceDisplay';
import { toleranceBoundsFromPoint } from './markerNumbering';
import {
  MEASUREMENT_POINT_INPUT_STATUS_LABEL,
  resolveMeasurementPointInputStatus
} from './measurementPointInputStatus';
import { formatInspectionDrawingPointDisplayName } from './measurementPointSupplement';
import {
  applyHundredthsDigitToDimensionValue,
  buildSelfInspectionDimensionTenthsOptions,
  formatDimensionTenthsProvisionalValue,
  resolveSelfInspectionMeasurementValueInputKind
} from './selfInspectionDimensionValueInput';
import { buildSelfInspectionMeasurementValueOptions } from './selfInspectionMeasurementValueOptions';

import type { InspectionDrawingPoint } from './types';

export type InspectionDrawingValueInputMode = 'free_only' | 'self_inspection_options';

export type InspectionDrawingValueCommitPayload = {
  pointId: string;
  value: string;
  source: 'dropdown' | 'hundredths_button' | 'enter' | 'blur' | 'blur_without_guide';
};

type Props = {
  point: InspectionDrawingPoint | null;
  readOnly?: boolean;
  onValueChange: (value: string) => void;
  /** デフォルトは自由入力。自主検査セッションのみ `self_inspection_options` */
  valueInputMode?: InspectionDrawingValueInputMode;
  /** 確定入力（dropdown / Enter / blur）。自主検査ガイド用 */
  onCommitValue?: (payload: InspectionDrawingValueCommitPayload) => void;
  /**
   * blur 重複抑止のスコープ（例: 入力件 index）。未指定時は測定点 ID のみ。
   * 同一 template 測定点 ID が複数入力件で再利用される自主検査向け。
   */
  valueCommitScopeKey?: string;
};

const STATUS_CLASS: Record<string, string> = {
  empty: 'text-slate-400',
  ok: 'text-emerald-400',
  ng: 'text-red-400',
  tolerance_error: 'text-amber-300',
  invalid: 'text-amber-300'
};

export function InspectionDrawingValuePanel({
  point,
  readOnly,
  onValueChange,
  valueInputMode = 'free_only',
  onCommitValue,
  valueCommitScopeKey = ''
}: Props) {
  const lastBlurCommitRef = useRef<{
    scopeKey: string;
    pointId: string;
    value: string;
  } | null>(null);
  const [dimensionTenthsBase, setDimensionTenthsBase] = useState<string | null>(null);

  useEffect(() => {
    lastBlurCommitRef.current = null;
    setDimensionTenthsBase(null);
  }, [point?.id, valueCommitScopeKey]);

  const measurementValueInputKind = useMemo(() => {
    if (!point || valueInputMode !== 'self_inspection_options') {
      return 'standard_options' as const;
    }
    return resolveSelfInspectionMeasurementValueInputKind(point);
  }, [point, valueInputMode]);

  const optionResult = useMemo(() => {
    if (!point || valueInputMode !== 'self_inspection_options') {
      return null;
    }
    if (measurementValueInputKind === 'dimension_hundredths') {
      return buildSelfInspectionDimensionTenthsOptions(point);
    }
    return buildSelfInspectionMeasurementValueOptions(point);
  }, [measurementValueInputKind, point, valueInputMode]);

  const emitCommit = (value: string, source: InspectionDrawingValueCommitPayload['source']) => {
    if (!point || !onCommitValue || readOnly) return;
    const prev = lastBlurCommitRef.current;
    if (
      (source === 'blur' || source === 'blur_without_guide') &&
      prev !== null &&
      prev.scopeKey === valueCommitScopeKey &&
      prev.pointId === point.id &&
      prev.value === value
    ) {
      return;
    }
    if (source === 'blur' || source === 'blur_without_guide') {
      lastBlurCommitRef.current = { scopeKey: valueCommitScopeKey, pointId: point.id, value };
    }
    onCommitValue({ pointId: point.id, value, source });
  };

  if (!point) {
    return (
      <div className="rounded border border-white/15 bg-slate-900/80 p-4 text-sm text-white/60">
        図面上の測定点を選んでください。
      </div>
    );
  }

  if (point.valueKind === 'judgement') {
    const inputStatus = resolveMeasurementPointInputStatus(point);
    const pointDisplayName = formatInspectionDrawingPointDisplayName(point);
    const chooseJudgement = (value: 'PASS' | 'FAIL') => {
      if (readOnly) return;
      onValueChange(value);
      emitCommit(value, 'dropdown');
    };
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-white/15 bg-slate-900/60 p-4 text-white">
        <div>
          <p className="text-lg font-bold">
            {pointDisplayName}（No.{point.markerNo}）
          </p>
          <p className="text-2xl text-white/80">管用ネジ形状の判定</p>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="管用ネジの判定">
          <button
            type="button"
            disabled={readOnly}
            className={clsx(
              'min-h-16 rounded-md border text-xl font-extrabold disabled:cursor-not-allowed disabled:opacity-40',
              point.testValue === 'PASS'
                ? 'border-emerald-300 bg-emerald-400 text-emerald-950'
                : 'border-emerald-300/40 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/60'
            )}
            onClick={() => chooseJudgement('PASS')}
          >
            OK
          </button>
          <button
            type="button"
            disabled={readOnly}
            className={clsx(
              'min-h-16 rounded-md border text-xl font-extrabold disabled:cursor-not-allowed disabled:opacity-40',
              point.testValue === 'FAIL'
                ? 'border-red-300 bg-red-400 text-red-950'
                : 'border-red-300/40 bg-red-950/40 text-red-100 hover:bg-red-900/60'
            )}
            onClick={() => chooseJudgement('FAIL')}
          >
            NG
          </button>
        </div>
        <p className={clsx('text-base font-bold', STATUS_CLASS[inputStatus])}>
          {MEASUREMENT_POINT_INPUT_STATUS_LABEL[inputStatus]}
        </p>
      </div>
    );
  }

  const bounds = toleranceBoundsFromPoint(point);
  const inputStatus = resolveMeasurementPointInputStatus(point);

  const isSelfInspectionOptions = valueInputMode === 'self_inspection_options';
  const showDropdown =
    optionResult?.mode === 'dropdown_and_free' && optionResult.options.length > 0;
  const showDimensionHundredths =
    isSelfInspectionOptions && measurementValueInputKind === 'dimension_hundredths' && showDropdown;
  const dimensionProvisionalDisplay = dimensionTenthsBase
    ? formatDimensionTenthsProvisionalValue(dimensionTenthsBase)
    : null;
  const dropdownHint =
    optionResult?.mode === 'free_only' && optionResult.reason && valueInputMode === 'self_inspection_options'
      ? optionResult.reason
      : null;
  const toleranceClassName = isSelfInspectionOptions ? 'text-2xl text-white/80' : 'text-sm text-white/70';
  const pointDisplayName = formatInspectionDrawingPointDisplayName(point);

  const manualInputField = (
    <input
      value={point.testValue}
      onChange={(e) => {
        setDimensionTenthsBase(null);
        onValueChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || readOnly) return;
        e.preventDefault();
        emitCommit(point.testValue, 'enter');
      }}
      onBlur={(e) => {
        const value = point.testValue;
        emitCommit(
          value,
          isSelfInspectionSessionChromeFocusTarget(e.relatedTarget) ? 'blur_without_guide' : 'blur'
        );
      }}
      disabled={readOnly}
      inputMode="decimal"
      className={kioskInputClassName}
      autoFocus={!showDropdown}
      key={
        onCommitValue
          ? valueCommitScopeKey
            ? `${valueCommitScopeKey}:${point.id}`
            : point.id
          : undefined
      }
    />
  );

  const handleDimensionHundredthsClick = (digit: number) => {
    if (!point || readOnly) return;
    const value = applyHundredthsDigitToDimensionValue(
      dimensionTenthsBase ?? point.testValue,
      digit
    );
    if (!value) return;
    setDimensionTenthsBase(null);
    onValueChange(value);
    emitCommit(value, 'hundredths_button');
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/15 bg-slate-900/60 p-4 text-white">
      <div>
        <p className="text-lg font-bold">
          {pointDisplayName}（No.{point.markerNo}）
        </p>
        <p className={toleranceClassName}>
          {'error' in bounds
            ? '基準・公差を設定してください'
            : formatInspectionDrawingToleranceDisplay(point, { includeLegacyReason: true })}
        </p>
      </div>
      {isSelfInspectionOptions && showDropdown ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="grid min-w-0 gap-1 text-sm font-semibold">
            測定値選択
            <div className={inspectionDrawingBoundedSelectShellClassName}>
              <select
                value=""
                disabled={readOnly}
                className={inspectionDrawingMeasurementValueSelectClassName}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  if (showDimensionHundredths) {
                    setDimensionTenthsBase(v);
                    return;
                  }
                  setDimensionTenthsBase(null);
                  onValueChange(v);
                  emitCommit(v, 'dropdown');
                }}
              >
                <option value=""></option>
                {optionResult.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-semibold">
            測定値（直接入力）
            {manualInputField}
          </label>
          {showDimensionHundredths ? (
            <div className="col-span-2 grid gap-2 rounded border border-white/10 bg-slate-950/40 p-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-white/75">百分台</span>
                <span className="min-h-6 rounded bg-slate-800 px-2 py-1 font-mono text-base text-amber-200">
                  {dimensionProvisionalDisplay ?? ''}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {Array.from({ length: 10 }, (_, digit) => (
                  <button
                    key={digit}
                    type="button"
                    disabled={readOnly || (!dimensionTenthsBase && !point.testValue.trim())}
                    className="min-h-11 rounded-md border border-white/20 bg-slate-950/60 text-lg font-bold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => handleDimensionHundredthsClick(digit)}
                  >
                    {digit}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {showDropdown ? (
            <label className="grid gap-1 text-sm font-semibold">
              測定値選択
              <div className={inspectionDrawingBoundedSelectShellClassName}>
                <select
                  value=""
                  disabled={readOnly}
                  className={inspectionDrawingMeasurementValueSelectClassName}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    onValueChange(v);
                    emitCommit(v, 'dropdown');
                  }}
                >
                  <option value=""></option>
                  {optionResult.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          ) : null}
          <label className="grid gap-1 text-sm font-semibold">
            測定値{showDropdown ? '（直接入力）' : ''}
            {manualInputField}
          </label>
        </>
      )}
      {dropdownHint ? <p className="text-xs text-white/55">{dropdownHint}</p> : null}
      <p className={clsx('text-base font-bold', STATUS_CLASS[inputStatus])}>
        {MEASUREMENT_POINT_INPUT_STATUS_LABEL[inputStatus]}
      </p>
    </div>
  );
}
