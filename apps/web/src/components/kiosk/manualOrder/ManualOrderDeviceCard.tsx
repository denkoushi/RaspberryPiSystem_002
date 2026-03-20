import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../../../features/kiosk/manualOrder/manualOrderOverviewTypography';

import { ManualOrderOverviewRowBlock } from './ManualOrderOverviewRowBlock';

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
      width="20"
      height="20"
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
  const locationLine = label.trim().length > 0 ? label.trim() : deviceScopeKey.trim();

  return (
    <article
      data-device-scope-key={deviceScopeKey}
      className={clsx(
        'rounded border bg-slate-900/60 p-3 transition-all',
        KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS,
        isActive ? 'border-cyan-300/70 shadow-[0_0_0_1px_rgba(34,211,238,0.3)]' : 'border-white/10',
        isDimmed ? 'opacity-55' : 'opacity-100',
        status === 'error' ? 'border-rose-400/80' : '',
        status === 'saving' ? 'animate-pulse' : ''
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight text-cyan-200" title={locationLine}>
            {locationLine}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(deviceScopeKey)}
          className="shrink-0 rounded border border-white/20 bg-white/10 p-1.5 text-amber-300 hover:bg-white/20"
          aria-label={`${locationLine} を編集`}
          title="編集"
        >
          <PencilIcon />
        </button>
      </div>

      {status === 'saving' ? <p className="mb-2 text-amber-200">保存中…</p> : null}
      {status === 'error' ? <p className="mb-2 text-rose-200">保存に失敗しました</p> : null}

      <div className="space-y-2">
        {resources.length === 0 ? (
          <p className="rounded bg-slate-800 px-3 py-2 text-white/60">手動順番は未設定です</p>
        ) : (
          resources.map((resource) => {
            const rows = resource.rows ?? [];
            return (
              <div key={resource.resourceCd} className="rounded bg-slate-800/80 px-3 py-2">
                <div className="mb-2 flex items-center justify-between gap-2 font-semibold">
                  <span className="text-white">{resource.resourceCd}</span>
                  <span className="shrink-0 font-normal text-white/55">{resource.assignedCount}件</span>
                </div>
                {rows.length > 0 ? (
                  <div className="space-y-1">
                    {rows.map((row) => (
                      <ManualOrderOverviewRowBlock
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
                  <p className="text-white/45">行データを取得できませんでした</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
