import { formatDueDate } from '../../../features/kiosk/productionSchedule/formatDueDate';
import {
  isProgressOverviewDueDateOverdue,
  progressOverviewResourceAriaLabel,
  progressOverviewResourceTooltip
} from '../../../features/kiosk/productionSchedule/progressOverviewPresentation';

import type {
  ProductionScheduleProgressOverviewPartItem,
  ProductionScheduleProgressOverviewProcessItem
} from '../../../api/client';

type ProgressOverviewPartRowProps = {
  part: ProductionScheduleProgressOverviewPartItem;
};

function ProcessChip({ process }: { process: ProductionScheduleProgressOverviewProcessItem }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] ${
        process.isCompleted
          ? 'border-slate-400 bg-white/10 text-white/70 opacity-50 grayscale'
          : 'border-blue-300 bg-blue-500/30 text-blue-100'
      }`}
      title={progressOverviewResourceTooltip(process.resourceNames)}
      aria-label={progressOverviewResourceAriaLabel(process.resourceCd, process.resourceNames)}
    >
      {process.resourceCd}
    </span>
  );
}

export function ProgressOverviewPartRow({ part }: ProgressOverviewPartRowProps) {
  return (
    <tr className="border-b border-white/10">
      <td className="min-w-0 px-1 py-1">{part.fhinmei || '-'}</td>
      <td className="w-[84px] whitespace-nowrap px-1 py-1 pr-0.5">
        <span
          className={
            isProgressOverviewDueDateOverdue(part.dueDate) ? 'font-semibold text-rose-300' : 'text-white'
          }
        >
          {formatDueDate(part.dueDate)}
        </span>
      </td>
      <td className="min-w-0 px-0.5 py-1">
        <div className="flex flex-wrap gap-1">
          {part.processes.map((process) => (
            <ProcessChip key={process.rowId} process={process} />
          ))}
        </div>
      </td>
    </tr>
  );
}
