import clsx from 'clsx';

import { KioskResourceProcessChips } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import { IconActionTooltip } from '../../../../components/ui/IconActionTooltip';
import { progressOverviewProcessChipClassName } from '../../productionSchedule/progressOverviewPresentation';

import { chipCodes, doneChipLabel, moreChipLabel } from './planningBoardChipStrips';

import type { KioskResourceProgressProcessChip } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

type Chips = readonly KioskResourceProgressProcessChip[];

/** One fitted chip line: a 「済N」 chip for done chips, the open chips, then a 「+N」 chip for what did not fit. */
export function PlanningBoardChipLine({ done, shown, hidden, chipClassName }: { done: Chips; shown: Chips; hidden: Chips; chipClassName?: string }) {
  return <>
    {done.length > 0 && <IconActionTooltip label={`完了: ${chipCodes(done)}`}>
      <span className={clsx(chipClassName, progressOverviewProcessChipClassName(true))}>{doneChipLabel(done.length)}</span>
    </IconActionTooltip>}
    {shown.length > 0 && <KioskResourceProcessChips processes={shown} className="flex-nowrap" />}
    {hidden.length > 0 && <IconActionTooltip label={`ほか: ${chipCodes(hidden)}`}>
      <span className={clsx(chipClassName, 'rounded border border-slate-500 px-1 py-0.5 text-[10px] leading-none text-slate-200')}>{moreChipLabel(hidden.length)}</span>
    </IconActionTooltip>}
  </>;
}
