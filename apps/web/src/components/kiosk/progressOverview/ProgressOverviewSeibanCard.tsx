import { normalizeMachineName } from '../../../features/kiosk/productionSchedule/machineName';

import { ProgressOverviewPartRow } from './ProgressOverviewPartRow';

import type { ProductionScheduleProgressOverviewSeibanItem } from '../../../api/client';

type ProgressOverviewSeibanCardProps = {
  item: ProductionScheduleProgressOverviewSeibanItem;
};

export function ProgressOverviewSeibanCard({ item }: ProgressOverviewSeibanCardProps) {
  return (
    <article className="rounded border border-white/20 bg-slate-800/60 p-2">
      <header className="mb-1 flex flex-wrap items-center gap-2 border-b border-white/15 pb-1">
        <span className="font-mono text-sm text-white">{item.fseiban}</span>
        <span className="text-[11px] text-white/70">{normalizeMachineName(item.machineName) || '-'}</span>
      </header>
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
