import { formatDueDateForProgressOverview } from '../../../features/kiosk/productionSchedule/formatDueDate';
import {
  isProgressOverviewDueDateOverdue,
  PROGRESS_OVERVIEW_PART_ROW_DUE_CELL_CLASS,
  PROGRESS_OVERVIEW_PART_ROW_PRODUCT_CELL_CLASS
} from '../../../features/kiosk/productionSchedule/progressOverviewPresentation';

import type { ProductionScheduleProgressOverviewPartItem } from '../../../api/client';

type ProgressOverviewPartRowProps = {
  part: ProductionScheduleProgressOverviewPartItem;
};

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
    </tr>
  );
}
