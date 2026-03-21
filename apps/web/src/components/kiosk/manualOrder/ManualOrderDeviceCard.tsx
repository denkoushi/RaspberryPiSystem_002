import clsx from 'clsx';

import { KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS } from '../../../features/kiosk/manualOrder/manualOrderOverviewTypography';

import { ManualOrderDeviceCardHeaderRow } from './ManualOrderDeviceCardHeaderRow';
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
  onOpenResourceAssignment?: (deviceScopeKey: string) => void;
};

export function ManualOrderDeviceCard({
  deviceScopeKey,
  label,
  resources,
  isActive,
  isDimmed,
  status,
  onSelect,
  onOpenResourceAssignment
}: Props) {
  const locationLine = label.trim().length > 0 ? label.trim() : deviceScopeKey.trim();
  const firstResource = resources[0];

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
      <ManualOrderDeviceCardHeaderRow
        locationLine={locationLine}
        resourceCd={firstResource?.resourceCd}
        assignedCount={firstResource?.assignedCount}
        isActive={isActive}
        onEdit={() => onSelect(deviceScopeKey)}
        onResourceSettings={
          onOpenResourceAssignment ? () => onOpenResourceAssignment(deviceScopeKey) : undefined
        }
      />

      {status === 'saving' ? <p className="mb-2 text-amber-200">保存中…</p> : null}
      {status === 'error' ? <p className="mb-2 text-rose-200">保存に失敗しました</p> : null}

      <div className="space-y-2">
        {resources.length === 0 ? (
          <p className="rounded bg-slate-800 px-3 py-2 text-white/60">資源未割り当て</p>
        ) : (
          resources.map((resource, index) => {
            const rows = resource.rows ?? [];
            const isFirst = index === 0;
            return (
              <div key={resource.resourceCd} className="rounded bg-slate-800/80 px-3 py-2">
                {!isFirst ? (
                  <div className="mb-2 flex items-center justify-between gap-2 font-semibold">
                    <span className="text-white">{resource.resourceCd}</span>
                    <span className="shrink-0 font-normal text-white/55">{resource.assignedCount}件</span>
                  </div>
                ) : null}
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
                  <p className="text-white/45">未設定</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}
