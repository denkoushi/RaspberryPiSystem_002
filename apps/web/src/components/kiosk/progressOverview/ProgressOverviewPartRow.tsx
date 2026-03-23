import { formatDueDateForProgressOverview } from '../../../features/kiosk/productionSchedule/formatDueDate';
import {
  isProgressOverviewDueDateOverdue,
  progressOverviewProcessChipClassName,
  progressOverviewResourceAriaLabel,
  progressOverviewResourceTooltip,
  PROGRESS_OVERVIEW_PART_ROW_DUE_CELL_CLASS,
  PROGRESS_OVERVIEW_PART_ROW_PRODUCT_CELL_CLASS,
  PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CELL_CLASS,
  PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CHIPS_CLASS
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
      className={progressOverviewProcessChipClassName(process.isCompleted)}
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
      <td className={PROGRESS_OVERVIEW_PART_ROW_PRODUCT_CELL_CLASS}>
        <span className="line-clamp-2 break-words">{part.fhinmei || '-'}</span>
      </td>
      <td className={PROGRESS_OVERVIEW_PART_ROW_DUE_CELL_CLASS}>
        <span
          className={
            isProgressOverviewDueDateOverdue(part.dueDate) ? 'font-semibold text-rose-300' : 'text-white'
          }
        >
          {formatDueDateForProgressOverview(part.dueDate)}
        </span>
      </td>
      <td className={PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CELL_CLASS}>
        <div className={PROGRESS_OVERVIEW_PART_ROW_RESOURCE_CHIPS_CLASS}>
          {part.processes.map((process) => (
            <ProcessChip key={process.rowId} process={process} />
          ))}
        </div>
      </td>
    </tr>
  );
}
