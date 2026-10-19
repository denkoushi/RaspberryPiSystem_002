import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { buttonClassName } from '../../../components/ui/Button';
import { KIOSK_SELF_INSPECTION_LIST_PATH, KIOSK_SELF_INSPECTION_REDUCTION_PATH } from '../selfInspectionRoutes';

import {
  SELF_INSPECTION_RECORD_APPROVAL_FILTERS,
  type SelfInspectionRecordApprovalFilter
} from './selfInspectionRecordApprovalViewModel';

type SelfInspectionRecordApprovalToolbarProps = {
  filter: SelfInspectionRecordApprovalFilter;
  onFilterChange: (filter: SelfInspectionRecordApprovalFilter) => void;
  productNo: string;
  resourceCd: string;
  onProductNoChange: (value: string) => void;
  onResourceCdChange: (value: string) => void;
  onClearSearch: () => void;
  requireMeasuringInstrumentTag: boolean;
  policyLoading: boolean;
  policyUpdatePending: boolean;
  policyMessage: string | null;
  onOpenPolicyDialog: () => void;
  showPolicyControl: boolean;
};

export function SelfInspectionRecordApprovalToolbar({
  filter,
  onFilterChange,
  productNo,
  resourceCd,
  onProductNoChange,
  onResourceCdChange,
  onClearSearch,
  requireMeasuringInstrumentTag,
  policyLoading,
  policyUpdatePending,
  policyMessage,
  onOpenPolicyDialog,
  showPolicyControl
}: SelfInspectionRecordApprovalToolbarProps) {
  const policyDisabled = policyLoading || policyUpdatePending;

  return (
    <div className="flex min-h-[60px] flex-wrap items-center gap-2.5 rounded-lg border border-white/15 bg-slate-900/70 py-2 pl-4 pr-2">
      <h1 className="mr-2 whitespace-nowrap text-[22px] font-black tracking-[0.03em]">検査記録確認</h1>

      <div
        className="flex h-11 items-stretch gap-1 rounded-lg border border-white/10 bg-slate-950/45 p-[3px]"
        role="group"
        aria-label="検査記録の表示フィルター"
      >
        {SELF_INSPECTION_RECORD_APPROVAL_FILTERS.map((option) => {
          const selected = filter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onFilterChange(option.value)}
              className={clsx(
                'rounded-md px-3 text-[15px] font-semibold transition-colors',
                selected
                  ? option.value === 'invalidated'
                    ? 'bg-rose-500/25 text-rose-100 ring-1 ring-rose-300/60'
                    : 'bg-sky-500/25 text-sky-100 ring-1 ring-sky-300/60'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {showPolicyControl ? (
        <button
          type="button"
          aria-label={`計測機器の使用前点検必須 ${requireMeasuringInstrumentTag ? 'ON' : 'OFF'}`}
          title="計測機器の使用前点検必須"
          aria-pressed={requireMeasuringInstrumentTag}
          disabled={policyDisabled}
          onClick={onOpenPolicyDialog}
          className={clsx(
            'inline-flex h-11 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 text-[15px] font-bold transition-colors',
            requireMeasuringInstrumentTag
              ? 'border-amber-300/45 bg-amber-400/15 text-amber-100'
              : 'border-white/15 bg-slate-950/70 text-white/75 hover:border-white/35',
            policyDisabled && 'opacity-60'
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden="true">
            <path d="M4 20h4l10-10-4-4L4 16v4z" />
            <path d="M13 7l4 4" />
          </svg>
          使用前点検
          <span
            aria-hidden="true"
            className={clsx(
              'relative inline-flex h-5 w-9 rounded-full border transition-colors',
              requireMeasuringInstrumentTag ? 'border-amber-200/70 bg-amber-300/80' : 'border-white/20 bg-white/10'
            )}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform',
                requireMeasuringInstrumentTag ? 'translate-x-4' : 'translate-x-0.5'
              )}
            />
          </span>
        </button>
      ) : null}
      {showPolicyControl && policyMessage ? (
        <span role="status" className="max-w-56 truncate text-xs text-amber-100" title={policyMessage}>
          {policyMessage}
        </span>
      ) : null}

      <span className="flex-1" />

      <input
        aria-label="製造order"
        className="h-11 w-40 rounded-lg border border-white/15 bg-slate-950/70 px-3 text-white placeholder:text-white/40"
        value={productNo}
        onChange={(event) => onProductNoChange(event.target.value)}
        placeholder="製造order"
      />
      <input
        aria-label="資源CD"
        className="h-11 w-24 rounded-lg border border-white/15 bg-slate-950/70 px-3 text-white placeholder:text-white/40"
        value={resourceCd}
        onChange={(event) => onResourceCdChange(event.target.value)}
        placeholder="資源CD"
      />
      <button
        type="button"
        aria-label="クリア"
        onClick={onClearSearch}
        className="grid h-11 w-11 place-items-center rounded-lg border border-white/15 text-white/70 hover:border-white/35 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="h-[18px] w-[18px]" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <span className="mx-1 h-7 w-px bg-white/15" aria-hidden="true" />
      <Link
        to={KIOSK_SELF_INSPECTION_LIST_PATH}
        aria-label="自主検査画面へ戻る"
        className={buttonClassName('ghostOnDark', 'inline-flex h-11 items-center justify-center whitespace-nowrap')}
      >
        自主検査へ
      </Link>
      <Link
        to={KIOSK_SELF_INSPECTION_REDUCTION_PATH}
        className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-lg bg-sky-300 px-4 font-bold text-[#06243a] transition hover:brightness-110"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
        詳細
      </Link>
    </div>
  );
}
