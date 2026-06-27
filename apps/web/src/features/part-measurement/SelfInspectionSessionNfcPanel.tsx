import { useState } from 'react';

import type { SelfInspectionSessionDetailDto } from './types';

type Props = {
  session: Pick<
    SelfInspectionSessionDetailDto,
    | 'operatorEmployeeNameSnapshot'
    | 'currentInspectionDateJst'
    | 'activeInstrumentUsageCount'
    | 'instrumentUsages'
  >;
  message?: string | null;
  busy?: boolean;
  readOnly?: boolean;
  onCancelUsage?: (usageId: string) => void;
};

function formatRegisteredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function SelfInspectionSessionNfcPanel({
  session,
  message,
  busy = false,
  readOnly = false,
  onCancelUsage
}: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const operatorName = session.operatorEmployeeNameSnapshot?.trim() || '未登録';
  const instrumentCount = session.activeInstrumentUsageCount;

  return (
    <div
      className="relative shrink-0 rounded border border-white/15 bg-slate-800/70 p-2"
      data-testid="self-inspection-session-nfc-panel"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="min-w-0 flex-1">
          <span className="text-white/55">作業者：</span>
          <span className="font-semibold text-white">{operatorName}</span>
        </div>
        <div
          className="relative"
          onMouseEnter={() => setDetailsOpen(true)}
          onMouseLeave={() => setDetailsOpen(false)}
        >
          <button
            type="button"
            className="rounded border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            onClick={() => setDetailsOpen((open) => !open)}
            onFocus={() => setDetailsOpen(true)}
            aria-expanded={detailsOpen}
          >
            計測機器 登録済み：{instrumentCount}台
          </button>
          {detailsOpen ? (
            <div className="absolute right-0 z-30 mt-2 w-[320px] max-w-[80vw] rounded border border-white/20 bg-slate-950 p-2 text-xs text-white shadow-xl">
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-1">
                <span className="font-semibold">計測機器</span>
                <span className="text-white/55">{session.currentInspectionDateJst}</span>
              </div>
              {session.instrumentUsages.length === 0 ? (
                <p className="text-white/60">未登録</p>
              ) : (
                <div className="flex max-h-60 flex-col gap-1 overflow-auto">
                  {session.instrumentUsages.map((usage) => (
                    <div key={usage.id} className="rounded border border-white/10 bg-white/5 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">
                            {usage.measuringInstrumentManagementNumberSnapshot}
                          </p>
                          <p className="truncate text-white/70">{usage.measuringInstrumentNameSnapshot}</p>
                          <p className="text-white/50">{formatRegisteredAt(usage.registeredAt)}</p>
                        </div>
                        {onCancelUsage && !readOnly ? (
                          <button
                            type="button"
                            className="shrink-0 rounded border border-red-300/40 px-2 py-1 text-red-100 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => onCancelUsage(usage.id)}
                          >
                            取消
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {message ? (
        <p className="mt-2 rounded border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-xs text-amber-100">
          {message}
        </p>
      ) : null}
    </div>
  );
}
