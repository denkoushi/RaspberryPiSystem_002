import { useMemo } from 'react';

import { collectAggregatedProgressOverviewResourceProcesses } from '../../../features/kiosk/productionSchedule/collectAggregatedProgressOverviewResourceProcesses';
import { normalizeMachineName } from '../../../features/kiosk/productionSchedule/machineName';
import { KioskResourceProcessChips } from '../resourceProgress/KioskResourceProcessChips';

import { ProgressOverviewPartRow } from './ProgressOverviewPartRow';

import type { ProductionScheduleProgressOverviewSeibanItem } from '../../../api/client';

type ProgressOverviewSeibanCardProps = {
  item: ProductionScheduleProgressOverviewSeibanItem;
};

export function ProgressOverviewSeibanCard({ item }: ProgressOverviewSeibanCardProps) {
  const aggregatedProcesses = useMemo(
    () => collectAggregatedProgressOverviewResourceProcesses(item.fseiban, item.parts),
    [item.fseiban, item.parts]
  );

  return (
    <article className="rounded border border-white/20 bg-slate-800/60 p-2">
      <header className="mb-1 flex flex-wrap items-center gap-2 border-b border-white/15 pb-1">
        <span className="font-mono text-sm text-white">{item.fseiban}</span>
        <span className="text-[11px] text-white/70">{normalizeMachineName(item.machineName) || '-'}</span>
      </header>
      {aggregatedProcesses.length > 0 ? (
        <div className="border-b border-white/10 pb-2 pt-1.5">
          <KioskResourceProcessChips processes={aggregatedProcesses} />
        </div>
      ) : null}
      <table className="w-full border-collapse text-left text-xs text-white">
        <tbody>
          {item.parts.map((part) => (
            <ProgressOverviewPartRow key={`${item.fseiban}-${part.fhincd}-${part.productNo}`} part={part} />
          ))}
        </tbody>
      </table>
    </article>
  );
}
