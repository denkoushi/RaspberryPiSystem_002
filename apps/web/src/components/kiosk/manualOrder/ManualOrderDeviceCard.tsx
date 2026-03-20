import clsx from 'clsx';

import type { ProductionScheduleDueManagementManualOrderOverviewResource } from '../../../api/client';

type Props = {
  deviceScopeKey: string;
  label: string;
  resources: ProductionScheduleDueManagementManualOrderOverviewResource[];
  isActive: boolean;
  isDimmed: boolean;
  status: 'idle' | 'saving' | 'error';
  onSelect: (deviceScopeKey: string) => void;
};

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

export function ManualOrderDeviceCard({
  deviceScopeKey,
  label,
  resources,
  isActive,
  isDimmed,
  status,
  onSelect
}: Props) {
  return (
    <article
      data-device-scope-key={deviceScopeKey}
      className={clsx(
        'rounded border bg-slate-900/60 p-2 transition-all',
        isActive ? 'border-cyan-300/70 shadow-[0_0_0_1px_rgba(34,211,238,0.3)]' : 'border-white/10',
        isDimmed ? 'opacity-55' : 'opacity-100',
        status === 'error' ? 'border-rose-400/80' : '',
        status === 'saving' ? 'animate-pulse' : ''
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-cyan-200" title={label}>
            {label}
          </p>
          <p className="truncate text-[11px] text-white/60" title={deviceScopeKey}>
            {deviceScopeKey}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(deviceScopeKey)}
          className="rounded border border-white/20 bg-white/10 p-1.5 text-amber-300 hover:bg-white/20"
          aria-label={`${label} を編集`}
          title="編集"
        >
          <PencilIcon />
        </button>
      </div>

      {status === 'saving' ? <p className="mb-1 text-[11px] text-amber-200">保存中…</p> : null}
      {status === 'error' ? <p className="mb-1 text-[11px] text-rose-200">保存に失敗しました</p> : null}

      <div className="space-y-1">
        {resources.length === 0 ? (
          <p className="rounded bg-slate-800 px-2 py-1 text-[11px] text-white/60">手動順番は未設定です</p>
        ) : (
          resources.map((resource) => (
            <div key={resource.resourceCd} className="rounded bg-slate-800 px-2 py-1 text-[11px] text-white/80">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white">{resource.resourceCd}</span>
                <span className="text-white/60">{resource.assignedCount}件</span>
              </div>
              <div className="mt-0.5 text-white/60">
                最大順番: {resource.maxOrderNumber ?? '-'} / 比較件数: {resource.comparedCount}
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
