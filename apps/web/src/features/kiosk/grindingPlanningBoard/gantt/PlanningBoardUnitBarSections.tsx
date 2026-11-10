import type { GanttBar } from './planningBoardGanttLayout';

export const GANTT_SETUP_HATCH = 'repeating-linear-gradient(135deg, #94a3b8 0 4px, #475569 4px 8px)';

export function PlanningBoardUnitBarSections({ bar, start, end }: { bar: GanttBar; start: number; end: number }) {
  const style = (left: number, right: number) => ({ left: `${(left - start) / (end - start) * 100}%`, width: `${(right - left) / (end - start) * 100}%` });
  return <>
    {bar.setupSegments?.map((segment, index) => {
      const left = Math.max(start, segment.start); const right = Math.min(end, segment.end);
      return right > left ? <span key={`setup:${index}`} aria-hidden="true" data-gantt-setup className="pointer-events-none absolute inset-y-0" style={{ ...style(left, right), background: GANTT_SETUP_HATCH }} /> : null;
    })}
    {bar.opSegments?.map((segment, index) => {
      const left = Math.max(start, segment.start); const right = Math.min(end, segment.end);
      return right > left ? <span key={`op:${index}`} aria-hidden="true" data-gantt-op={segment.opNo} data-gantt-op-completed={segment.completed || undefined}
        className={`pointer-events-none absolute inset-y-0 border-l border-slate-950/50 ${segment.completed ? 'bg-slate-600 text-slate-300 opacity-75' : ''}`} style={style(left, right)} /> : null;
    })}
  </>;
}
