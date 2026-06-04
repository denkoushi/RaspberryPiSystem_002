import clsx from 'clsx';
import { useEffect, useMemo, useRef } from 'react';

import { Input } from '../../../components/ui/Input';

import { evaluateMeasurementValue, parseMeasurementNumber } from './evaluateMeasurement';
import {
  inspectionDrawingBoundedSelectClassName,
  inspectionDrawingBoundedSelectShellClassName,
  isSelfInspectionSessionChromeFocusTarget
} from './inspectionDrawingKioskUi';
import { isLegacyAbsoluteOnlyPoint, toleranceBoundsFromPoint } from './markerNumbering';
import { buildSelfInspectionMeasurementValueOptions } from './selfInspectionMeasurementValueOptions';

import type { InspectionDrawingPoint } from './types';

export type InspectionDrawingValueInputMode = 'free_only' | 'self_inspection_options';

export type InspectionDrawingValueCommitPayload = {
  pointId: string;
  value: string;
  source: 'dropdown' | 'enter' | 'blur' | 'blur_without_guide';
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

const STATUS_LABEL: Record<string, string> = {
  empty: '未入力',
  ok: 'OK',
  ng: 'NG'
};

const STATUS_CLASS: Record<string, string> = {
  empty: 'text-slate-400',
  ok: 'text-emerald-400',
  ng: 'text-red-400'
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

  useEffect(() => {
    lastBlurCommitRef.current = null;
  }, [point?.id, valueCommitScopeKey]);

  const optionResult = useMemo(() => {
    if (!point || valueInputMode !== 'self_inspection_options') {
      return null;
    }
    return buildSelfInspectionMeasurementValueOptions(point);
  }, [point, valueInputMode]);

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

  const parsed = parseMeasurementNumber(point.testValue);
  const legacyDisplay = isLegacyAbsoluteOnlyPoint(point);
  const bounds = toleranceBoundsFromPoint(point);
  const status =
    'error' in bounds ? 'empty' : evaluateMeasurementValue(parsed, bounds.lowerLimit, bounds.upperLimit);

  const showDropdown =
    optionResult?.mode === 'dropdown_and_free' && optionResult.options.length > 0;
  const dropdownHint =
    optionResult?.mode === 'free_only' && optionResult.reason && valueInputMode === 'self_inspection_options'
      ? optionResult.reason
      : null;

  return (
    <div className="flex flex-col gap-3 rounded border border-white/20 bg-slate-900/90 p-4 text-white shadow-lg">
      <div>
        <p className="text-lg font-bold">
          {point.name || '測定点'}（No.{point.markerNo}）
        </p>
        <p className="text-sm text-white/70">
          {'error' in bounds
            ? '基準・公差を設定してください'
            : legacyDisplay && point.legacyAbsoluteBounds
              ? `合格範囲 ${point.legacyAbsoluteBounds.lowerLimit} – ${point.legacyAbsoluteBounds.upperLimit}（基準値未設定）`
              : `基準 ${bounds.nominal} / ${bounds.lowerLimit} – ${bounds.upperLimit}`}
        </p>
      </div>
      {showDropdown ? (
        <label className="grid gap-1 text-sm font-semibold">
          候補から選択
          <div className={inspectionDrawingBoundedSelectShellClassName}>
            <select
              value=""
              disabled={readOnly}
              className={inspectionDrawingBoundedSelectClassName}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                onValueChange(v);
                emitCommit(v, 'dropdown');
              }}
            >
              <option value="">候補を選ぶ（刻み {optionResult.stepLabel}）</option>
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
        <Input
          value={point.testValue}
          onChange={(e) => onValueChange(e.target.value)}
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
          className="w-full text-slate-900"
          autoFocus={!showDropdown}
          key={
            onCommitValue
              ? valueCommitScopeKey
                ? `${valueCommitScopeKey}:${point.id}`
                : point.id
              : undefined
          }
        />
      </label>
      {dropdownHint ? <p className="text-xs text-white/55">{dropdownHint}</p> : null}
      <p className={clsx('text-base font-bold', STATUS_CLASS[status])}>{STATUS_LABEL[status]}</p>
    </div>
  );
}
