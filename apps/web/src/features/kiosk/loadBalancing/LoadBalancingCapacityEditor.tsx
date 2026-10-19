import { useState } from 'react';

import { formatHours } from './loadBalancingFormat';

type Props = {
  resourceCd: string;
  currentMinutes: number | null;
  saving: boolean;
  error: string | null;
  onSave: (minutes: number) => void;
  onCancel: () => void;
};

/** 基準能力（月あたり H）をその場で入力する。保存は分に換算して送る */
export function LoadBalancingCapacityEditor({ resourceCd, currentMinutes, saving, error, onSave, onCancel }: Props) {
  const [hoursText, setHoursText] = useState(currentMinutes == null ? '' : formatHours(currentMinutes));
  const hours = Number(hoursText);
  const valid = hoursText.trim().length > 0 && Number.isFinite(hours) && hours >= 0 && hours <= 10000;

  const submit = () => {
    if (valid && !saving) onSave(Math.round(hours * 60));
  };

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex items-center gap-2 font-bold">
        <span className="text-sm text-white/65">能力</span>
        <input
          autoFocus
          inputMode="decimal"
          aria-label={`${resourceCd} の月あたり能力（時間）`}
          className="h-10 w-24 rounded-lg border border-white/25 bg-slate-950 px-2 text-right text-lg font-bold tabular-nums text-white"
          value={hoursText}
          onChange={(event) => setHoursText(event.target.value.replace(/[^\d.]/g, ''))}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        />
        <span className="text-sm text-white/65">H/月</span>
      </label>
      <button
        type="submit"
        className="h-10 rounded-lg bg-emerald-600 px-4 font-bold text-white disabled:opacity-40"
        disabled={!valid || saving}
      >
        {saving ? '保存中' : '保存'}
      </button>
      <button type="button" className="h-10 rounded-lg px-3 font-bold text-white/70 hover:bg-slate-800" onClick={onCancel}>
        やめる
      </button>
      {error ? (
        <span className="text-sm text-rose-200" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
