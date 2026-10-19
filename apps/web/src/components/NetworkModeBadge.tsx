import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';

import { useNetworkModeStatus } from '../api/hooks';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside';

const MODE_LABELS: Record<'local' | 'maintenance', string> = {
  local: 'ローカル運用モード',
  maintenance: 'メンテナンスモード'
};

const MODE_SHORT_LABELS: Record<'local' | 'maintenance', string> = {
  local: 'ローカル運用',
  maintenance: 'メンテナンス'
};

const MODE_COLORS: Record<'local' | 'maintenance', string> = {
  local: 'bg-emerald-400 ring-emerald-400/25',
  maintenance: 'bg-orange-400 ring-orange-400/25'
};

const pillClass = 'flex h-[34px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-2.5 text-sm font-semibold';
const dotClass = 'inline-flex h-2 w-2 shrink-0 rounded-full ring-[3px]';

export function NetworkModeBadge() {
  const { data, isLoading, isError } = useNetworkModeStatus();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(rootRef, open, close);

  if (isLoading) {
    return (
      <div className={clsx(pillClass, 'border-white/10 text-white/60')} title="ネットワークモードを取得中">
        <span className={clsx(dotClass, 'bg-white/40 ring-white/10')} />
        <span className="hidden sm:inline">確認中</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={clsx(pillClass, 'border-rose-500/45 text-rose-100')} title="ネットワークモードを取得できません">
        <span className={clsx(dotClass, 'bg-rose-400 ring-rose-400/25')} />
        <span className="hidden sm:inline">取得できません</span>
        <span className="sr-only sm:hidden">ネットワークモードを取得できません</span>
      </div>
    );
  }

  const color = MODE_COLORS[data.detectedMode];
  const label = MODE_LABELS[data.detectedMode];
  const mismatch = data.detectedMode !== data.configuredMode;
  const networkLabel = data.status === 'internet_connected' ? 'インターネット接続あり' : 'ローカルネットワークのみ';
  const latency = data.latencyMs !== undefined ? `${data.latencyMs.toFixed(0)}ms` : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className={clsx(pillClass, 'border-white/10 text-white transition-colors hover:border-white/25')}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`ネットワーク状態: ${label}${mismatch ? '（設定値と不一致）' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={clsx(dotClass, color)} />
        <span className="hidden sm:inline">{MODE_SHORT_LABELS[data.detectedMode]}</span>
        {mismatch ? (
          <svg width="12" height="12" viewBox="0 0 12 12" className="text-amber-300" aria-hidden="true">
            <path d="M6 1 11.2 10.5H.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M6 4.6v2.6M6 8.7v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        ) : null}
        {latency ? (
          <span className="hidden font-mono text-[11px] font-medium tabular-nums text-white/50 2xl:inline">{latency}</span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="ネットワーク状態"
          className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/20 bg-slate-900 p-3.5 shadow-2xl"
        >
          <div className="mb-2.5 flex items-center gap-2 text-sm font-bold text-white">
            <span className={clsx(dotClass, color)} />
            {label}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-white/50">設定値</dt>
            <dd className="text-right text-white/90">{MODE_LABELS[data.configuredMode]}</dd>
            <dt className="text-white/50">接続</dt>
            <dd className="text-right text-white/90">{networkLabel}</dd>
            {latency ? (
              <>
                <dt className="text-white/50">判定</dt>
                <dd className="text-right tabular-nums text-white/90">{latency}</dd>
              </>
            ) : null}
            <dt className="text-white/50">更新</dt>
            <dd className="text-right tabular-nums text-white/90">
              {new Date(data.checkedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </dd>
          </dl>
          {mismatch ? (
            <p className="mt-3 rounded-lg bg-amber-500/15 px-2.5 py-2 text-xs text-amber-200">設定値と実際の状態が違います</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
