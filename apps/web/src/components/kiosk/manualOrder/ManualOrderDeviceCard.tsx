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

function RowDetailBlock({
  fseiban,
  fhincd,
  processLabel,
  machineName,
  partName
}: {
  fseiban: string;
  fhincd: string;
  processLabel: string;
  machineName: string;
  partName: string;
}) {
  const line2 = Boolean(machineName.trim()) || Boolean(partName.trim());
  return (
    <div className="rounded bg-slate-800/90 px-1.5 py-1 text-[10px] leading-snug text-white/85">
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {fseiban.trim().length > 0 ? <span className="font-semibold tabular-nums text-white">{fseiban}</span> : null}
        {fseiban.trim().length > 0 && fhincd.trim().length > 0 ? (
          <span className="text-white/35" aria-hidden>
            ·
          </span>
        ) : null}
        {fhincd.trim().length > 0 ? (
          <span className="font-mono text-[9px] text-slate-200">{fhincd}</span>
        ) : null}
        {processLabel.trim().length > 0 ? (
          <>
            {(fseiban.trim().length > 0 || fhincd.trim().length > 0) ? (
              <span className="text-white/35" aria-hidden>
                ·
              </span>
            ) : null}
            <span className="text-white/55">{processLabel}</span>
          </>
        ) : null}
      </div>
      {line2 ? (
        <div className="mt-0.5 truncate text-[9px] text-white/50" title={[machineName, partName].filter(Boolean).join(' · ')}>
          {machineName.trim().length > 0 ? <span className="text-slate-400">{machineName}</span> : null}
          {machineName.trim().length > 0 && partName.trim().length > 0 ? (
            <span className="mx-1 text-white/30" aria-hidden>
              ·
            </span>
          ) : null}
          {partName.trim().length > 0 ? <span>{partName}</span> : null}
        </div>
      ) : null}
    </div>
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

      <div className="space-y-1.5">
        {resources.length === 0 ? (
          <p className="rounded bg-slate-800 px-2 py-1 text-[11px] text-white/60">手動順番は未設定です</p>
        ) : (
          resources.map((resource) => {
            const rows = resource.rows ?? [];
            return (
              <div key={resource.resourceCd} className="rounded bg-slate-800/80 px-2 py-1.5">
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                  <span className="font-semibold text-white">{resource.resourceCd}</span>
                  <span className="shrink-0 text-white/55">{resource.assignedCount}件</span>
                </div>
                {rows.length > 0 ? (
                  <div className="space-y-0.5">
                    {rows.map((row) => (
                      <RowDetailBlock
                        key={`${resource.resourceCd}-${row.orderNumber}-${row.fseiban}-${row.fhincd}`}
                        fseiban={row.fseiban}
                        fhincd={row.fhincd}
                        processLabel={row.processLabel}
                        machineName={row.machineName}
                        partName={row.partName}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-white/45">行データを取得できませんでした</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
