import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { pageZoom } from '../pageZoom';
import { PLANNING_BOARD_TWO_MACHINE, PLANNING_BOARD_TWO_MACHINE_RESOURCES, planningBoardResourceMatches } from '../planningBoardTwoMachine';

import { planningBoardVisibleBars } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

type Props = PlanningBoardGanttProps & { valueSheetResource?: string | null };

const TwoMachineGantt = forwardRef<PlanningBoardGanttHandle, Props>(function TwoMachineGantt(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<string, PlanningBoardGanttHandle>());
  const nextLate = useRef(-1);
  const [height, setHeight] = useState<number>();
  const lateBars = useMemo(() => planningBoardVisibleBars(props.layout).filter((bar) =>
    bar.tone === 'late' && planningBoardResourceMatches(PLANNING_BOARD_TWO_MACHINE, bar.resource)), [props.layout]);
  const navigate = (itemId: string) => {
    const bar = props.layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars)).find((bar) => bar.item.itemId === itemId);
    if (bar) handles.current.get(bar.resource)?.scrollToItem(itemId);
  };
  useImperativeHandle(ref, () => ({
    scrollToItem: navigate,
    scrollToNextLate: () => {
      if (!lateBars.length) return;
      nextLate.current = (nextLate.current + 1) % lateBars.length;
      const bar = lateBars[nextLate.current]!;
      handles.current.get(bar.resource)?.scrollToItem(bar.item.itemId);
    },
    scrollToNextOverlap: () => handles.current.forEach((handle) => handle.scrollToNextOverlap())
  }));
  useLayoutEffect(() => {
    const measure = () => {
      if (container.current) setHeight(Math.max(0, Math.floor((window.innerHeight - container.current.getBoundingClientRect().top) / pageZoom() - 10)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (container.current?.parentElement) observer?.observe(container.current.parentElement);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, []);
  return <div ref={container} data-testid="planning-two-machine" className="mt-2 grid min-h-0 grid-rows-2 overflow-hidden rounded-lg border border-slate-700" style={{ height }}>
    {PLANNING_BOARD_TWO_MACHINE_RESOURCES.map((resource, index) => <section key={resource} aria-label={resource}
      className={`flex min-h-0 overflow-hidden ${index ? 'border-t-4 border-slate-500 bg-emerald-950/20' : 'bg-slate-900'}`}>
      <div className={`flex w-9 shrink-0 items-center justify-center border-r border-slate-600 font-mono text-base font-bold ${index ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-sky-300'}`}>{resource}</div>
      <div className={`min-h-0 min-w-0 flex-1 ${index ? '[&>section]:bg-emerald-950/20' : ''}`}>
        <PlanningBoardGanttView {...props} fitPane singleResourceCd={resource}
          ref={(handle) => { if (handle) handles.current.set(resource, handle); else handles.current.delete(resource); }}
          valueSheetOpen={props.valueSheetResource === resource} onToggleValueSheet={() => props.onToggleValueSheet?.(resource)}
          onNavigateBar={(bar) => {
            if (!planningBoardResourceMatches(PLANNING_BOARD_TWO_MACHINE, bar.resource)) return false;
            handles.current.get(bar.resource)?.scrollToItem(bar.item.itemId);
            return true;
          }} />
      </div>
    </section>)}
  </div>;
});

export const PlanningBoardGanttDisplay = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttDisplay(props, ref) {
  return props.singleResourceCd === PLANNING_BOARD_TWO_MACHINE
    ? <TwoMachineGantt {...props} ref={ref} />
    : <PlanningBoardGanttView {...props} ref={ref} />;
});
