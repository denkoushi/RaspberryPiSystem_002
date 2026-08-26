import clsx from 'clsx';
import { Link } from 'react-router-dom';

import { Button, buttonClassName } from '../../../components/ui/Button';
import { KIOSK_SELF_INSPECTION_LIST_PATH } from '../selfInspectionRoutes';

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
    <div className="rounded border border-white/15 bg-slate-900/70 p-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-52">
          <h1 className="text-2xl font-bold">検査記録確認</h1>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-end justify-end gap-2">
          <Link
            to={KIOSK_SELF_INSPECTION_LIST_PATH}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center justify-center whitespace-nowrap')}
          >
            自主検査画面へ戻る
          </Link>
          <div className="grid gap-1 text-sm">
            <span className="text-white/65">表示</span>
            <div
              className="flex flex-wrap gap-1 rounded border border-white/10 bg-slate-950/45 p-1"
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
                      'min-h-10 rounded px-3 py-2 text-sm font-semibold transition-colors',
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
          </div>

          {showPolicyControl ? (
            <div className="grid gap-1 text-sm">
              <span className="text-white/65">計測機器の使用前点検必須</span>
              <button
                type="button"
                aria-label={`計測機器の使用前点検必須 ${requireMeasuringInstrumentTag ? 'ON' : 'OFF'}`}
                aria-pressed={requireMeasuringInstrumentTag}
                disabled={policyDisabled}
                onClick={onOpenPolicyDialog}
                className={clsx(
                  'inline-flex min-h-10 items-center gap-2 rounded border px-3 text-sm font-semibold transition-colors',
                  requireMeasuringInstrumentTag
                    ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                    : 'border-white/15 bg-slate-950/70 text-white/75 hover:border-white/35',
                  policyDisabled && 'opacity-60'
                )}
              >
                <span
                  className={clsx(
                    'relative inline-flex h-5 w-9 rounded-full border transition-colors',
                    requireMeasuringInstrumentTag
                      ? 'border-amber-200/70 bg-amber-300/80'
                      : 'border-white/20 bg-white/10'
                  )}
                >
                  <span
                    className={clsx(
                      'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform',
                      requireMeasuringInstrumentTag ? 'translate-x-4' : 'translate-x-0.5'
                    )}
                  />
                </span>
                {requireMeasuringInstrumentTag ? 'ON' : 'OFF'}
              </button>
              {policyMessage ? <span className="max-w-64 text-xs text-amber-100">{policyMessage}</span> : null}
            </div>
          ) : null}

          <label className="grid min-w-44 gap-1 text-sm">
            <span className="text-white/65">製造order</span>
            <input
              className="min-h-10 rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
              value={productNo}
              onChange={(event) => onProductNoChange(event.target.value)}
              placeholder="製造order"
            />
          </label>
          <label className="grid w-28 gap-1 text-sm">
            <span className="text-white/65">資源CD</span>
            <input
              className="min-h-10 rounded border border-white/15 bg-slate-950/70 px-3 py-2 text-white"
              value={resourceCd}
              onChange={(event) => onResourceCdChange(event.target.value)}
              placeholder="581"
            />
          </label>
          <Button type="button" variant="ghostOnDark" onClick={onClearSearch}>
            クリア
          </Button>
        </div>
      </div>
    </div>
  );
}
