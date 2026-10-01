import clsx from 'clsx';

import type {
  ReductionFinding,
  ReductionFindingIcon,
  ReductionFindingTone,
  ReductionFindings as Findings
} from './selfInspectionReductionFindings';

export type ReductionFindingSlot = 'overall' | 'focus';

const ICON_PATHS: Record<ReductionFindingIcon, string> = {
  up: 'M4 16l6-6 4 4 6-7M15 7h5v5',
  flat: 'M4 12h15M15 8l4 4-4 4',
  down: 'M4 8l6 6 4-4 6 7M15 17h5v-5',
  wait: 'M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8s8 3 8 8',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  flag: 'M5 21V4M5 4h12l-2.5 4 2.5 4H5',
  raise: 'M12 19V5M6 11l6-6 6 6',
  check: 'M5 12l5 5 9-10'
};

const TONE_CLASSES: Record<ReductionFindingTone, string> = {
  good: 'text-emerald-400',
  warn: 'text-amber-300',
  bad: 'text-rose-400',
  info: 'text-sky-300',
  muted: 'text-[#72849b]'
};

function Line({
  finding,
  slot,
  pressed,
  onPick
}: {
  finding: ReductionFinding;
  slot: ReductionFindingSlot;
  pressed: boolean;
  onPick: (slot: ReductionFindingSlot) => void;
}) {
  const body = (
    <>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={clsx('h-[17px] w-[17px] shrink-0', TONE_CLASSES[finding.tone])}
        aria-hidden="true"
      >
        <path d={ICON_PATHS[finding.icon]} />
      </svg>
      <span className="min-w-0 truncate">
        {finding.lead}
        {finding.fhincd ? <b className="font-mono font-semibold">{finding.fhincd}</b> : null}
        {finding.fhincd && !finding.text.startsWith('：') ? ' ' : ''}
        {finding.text}
      </span>
      {finding.moreCount > 0 ? (
        <span className="shrink-0 rounded-full border border-[#2f4159] px-1.5 text-xs font-bold leading-[18px] text-[#aab8ca]">
          ほか{finding.moreCount}
        </span>
      ) : null}
    </>
  );
  const className = clsx(
    'flex h-[26px] min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[15px] font-bold',
    slot === 'overall' ? 'text-[#aab8ca]' : 'text-[#e8eef6]'
  );
  if (finding.rowIds.length === 0) return <p className={className}>{body}</p>;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPick(slot)}
      className={clsx(className, 'hover:bg-[#172433]', pressed && 'bg-[#1f2f45]')}
    >
      {body}
    </button>
  );
}

/** 上辺の所見2行。行を押すと、挙げた品番に一覧を絞る。 */
export function ReductionFindings({
  findings,
  picked,
  onPick
}: {
  findings: Findings;
  picked: ReductionFindingSlot | null;
  onPick: (slot: ReductionFindingSlot) => void;
}) {
  return (
    <div role="group" aria-label="所見" className="grid h-[52px] min-w-0 flex-1 grid-rows-2 items-center justify-items-start">
      <Line finding={findings.overall} slot="overall" pressed={picked === 'overall'} onPick={onPick} />
      <Line finding={findings.focus} slot="focus" pressed={picked === 'focus'} onPick={onPick} />
    </div>
  );
}
