import clsx from 'clsx';

import { Input } from '../../../components/ui/Input';

import { evaluateMeasurementValue, parseMeasurementNumber } from './evaluateMeasurement';
import { toleranceBoundsFromPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';

type Props = {
  point: InspectionDrawingPoint | null;
  readOnly?: boolean;
  onValueChange: (value: string) => void;
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

export function InspectionDrawingValuePanel({ point, readOnly, onValueChange }: Props) {
  if (!point) {
    return (
      <div className="rounded border border-white/15 bg-slate-900/80 p-4 text-sm text-white/60">
        図面上の測定点を選んでください。
      </div>
    );
  }

  const parsed = parseMeasurementNumber(point.testValue);
  const bounds = toleranceBoundsFromPoint(point);
  const status =
    'error' in bounds ? 'empty' : evaluateMeasurementValue(parsed, bounds.lowerLimit, bounds.upperLimit);

  return (
    <div className="flex flex-col gap-3 rounded border border-white/20 bg-slate-900/90 p-4 text-white shadow-lg">
      <div>
        <p className="text-lg font-bold">
          {point.name || '測定点'}（No.{point.markerNo}）
        </p>
        <p className="text-sm text-white/70">
          {'error' in bounds
            ? '基準・公差を設定してください'
            : point.legacyAbsoluteBounds && !point.nominalRaw.trim()
              ? `合格範囲 ${bounds.lowerLimit} – ${bounds.upperLimit}（基準値未設定）`
              : `基準 ${bounds.nominal} / ${bounds.lowerLimit} – ${bounds.upperLimit}`}
        </p>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        測定値
        <Input
          value={point.testValue}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={readOnly}
          inputMode="decimal"
          className="w-full text-slate-900"
          autoFocus
        />
      </label>
      <p className={clsx('text-base font-bold', STATUS_CLASS[status])}>{STATUS_LABEL[status]}</p>
    </div>
  );
}
