import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { pageZoom } from '../pageZoom';
import { PlanningBoardSingleResourcePicker } from '../PlanningBoardSingleResourcePicker';
import { planningBoardPair, planningBoardResourceMatches } from '../planningBoardTwoMachine';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

import { planningBoardVisibleBars } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

type Props = PlanningBoardGanttProps & { valueSheetResource?: string | null };

const TwoMachineGantt = forwardRef<PlanningBoardGanttHandle, Props>(function TwoMachineGantt(props, ref) {
  const resources = useMemo(() => planningBoardPair(props.singleResourceCd)!, [props.singleResourceCd]);
  const [headContainer, setHeadContainer] = useState<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState<{ anchor: HTMLElement; index: number } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const handles = useRef(new Map<string, PlanningBoardGanttHandle>());
  const nextLate = useRef(0);
  const nextOverlap = useRef(0);
  const resourceLayouts = useMemo(() => resources.map((resource) => {
    const groups = props.layout.groups.filter((group) => group.resource === resource);
    return { ...props.layout,
      groups: groups.length ? groups : [{ key: resource, label: resource, resource,
        rows: [{ key: resource, label: resource, detail: '', bars: [], flagged: false, connectors: [] }] }],
      forwardQueue: props.layout.forwardQueue?.filter((bar) => bar.resource === resource)
    };
  }), [props.layout, resources]);
  const overlapBars = useMemo(() => resourceLayouts.flatMap((layout) => layout.groups.flatMap((group) =>
    group.rows.filter((row) => row.flagged).flatMap((row) => planningBoardVisibleBars({ ...layout, groups: [{ ...group, rows: [row] }] }).slice(0, 1)))), [resourceLayouts]);
  useLayoutEffect(() => { nextLate.current = 0; nextOverlap.current = 0; }, [props.layout, resources]);
  const [height, setHeight] = useState<number>();
  const lateBars = useMemo(() => planningBoardVisibleBars(props.layout).filter((bar) =>
    bar.tone === 'late' && planningBoardResourceMatches(props.singleResourceCd!, bar.resource)), [props.layout, props.singleResourceCd]);
  const navigate = (itemId: string) => {
    const bar = props.layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars)).find((bar) => bar.item.itemId === itemId);
    return bar ? handles.current.get(bar.resource)?.scrollToItem(itemId) ?? false : false;
  };
  useImperativeHandle(ref, () => ({
    scrollToItem: navigate,
    scrollToNextLate: () => {
      // Folded rows can disappear as time advances; skip them within the same press.
      for (let attempt = 0; attempt < lateBars.length; attempt++) {
        const bar = lateBars[nextLate.current]!;
        nextLate.current = (nextLate.current + 1) % lateBars.length;
        if (handles.current.get(bar.resource)?.scrollToItem(bar.item.itemId)) return;
      }
    },
    scrollToNextOverlap: () => {
      if (!overlapBars.length) return;
      const bar = overlapBars[nextOverlap.current]!;
      nextOverlap.current = (nextOverlap.current + 1) % overlapBars.length;
      handles.current.get(bar.resource)?.scrollToItem(bar.item.itemId);
    }
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
  return <div ref={container} data-testid="planning-two-machine" className="mt-2 flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700" style={{ height }}>
    <div ref={setHeadContainer} className="shrink-0" />
    <div className="grid min-h-0 flex-1 grid-rows-2">
    {resources.map((resource, index) => <section key={resource} aria-label={resource}
      className={`flex min-h-0 overflow-hidden bg-slate-900 ${index ? 'border-t-4 border-slate-500' : ''}`}>
      <button type="button" aria-label={`${resource}の機械を選ぶ`} aria-expanded={picker?.index === index} onClick={(event) => setPicker({ anchor: event.currentTarget, index })} className={`flex w-9 flex-col shrink-0 items-center justify-center border-r border-slate-600 font-mono text-base font-bold ${index ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-sky-300'}`}>{resource}<span className="text-[10px]">▼</span></button>
      <div className="min-h-0 min-w-0 flex-1">
        <PlanningBoardGanttView {...props} layout={resourceLayouts[index]!} fitPane singleResourceCd={resource} resourceHeadContainer={index === 0 ? headContainer : undefined} hideResourceHead={index !== 0} onResourceMove={undefined} canMoveResource={undefined}
          ref={(handle) => { if (handle) handles.current.set(resource, handle); else handles.current.delete(resource); }}
          valueSheetOpen={index === 0 && props.valueSheetResource === resource} onToggleValueSheet={() => props.onToggleValueSheet?.(resource)}
          onNavigateBar={(bar) => {
            if (!planningBoardResourceMatches(props.singleResourceCd!, bar.resource)) return false;
            handles.current.get(bar.resource)?.scrollToItem(bar.item.itemId);
            return true;
          }} />
      </div>
    </section>)}
    </div>
    {picker && <PlanningBoardSingleResourcePicker anchor={picker.anchor} resources={props.resourceLanes ?? props.layout.groups.map(group => group.resource!).filter(Boolean)}
      resourceCd={resources[picker.index]!} resourceNameMap={props.resourceNameMap}
      isDisabled={(resource) => !isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource)} onClose={() => setPicker(null)}
      onSelect={(resource) => {
        if (!isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource)) return;
        const next = [...resources];
        if (resource === resources[1 - picker.index]) next.reverse();
        else next[picker.index] = resource;
        props.onSingleResourceChange?.(next.join('+'));
        setPicker(null);
      }} />}
  </div>;
});

export const PlanningBoardGanttDisplay = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttDisplay(props, ref) {
  const pair = planningBoardPair(props.singleResourceCd);
  const resources = props.resourceLanes ?? (props.singleResourceCd ? props.layout.groups.map(group => group.resource!).filter(Boolean) : []);
  const top = pair?.[0] ?? props.singleResourceCd;
  const enabled = resources.filter(resource => isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource)).sort();
  const canPair = Boolean(top && enabled.includes(top) && enabled.length > 1);
  const partnerKey = `kiosk.planning-board.machine-partners:${props.preferenceScope ?? 'default'}`;
  const lastSelected = useRef<string | null>(null);
  const changeSelection = (selection: string | null) => {
    const nextPair = planningBoardPair(selection) ?? pair;
    if (nextPair) {
      try {
        const saved = JSON.parse(localStorage.getItem(partnerKey) ?? '{}');
        const partners = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        partners[nextPair[0]] = nextPair[1]; partners[nextPair[1]] = nextPair[0];
        localStorage.setItem(partnerKey, JSON.stringify(partners));
      } catch { /* Device storage is optional. */ }
    }
    props.onSingleResourceChange?.(selection);
  };
  const onMachineModeChange = (mode: 1 | 2) => {
    if (!top) return;
    if (mode === 1) {
      if (!pair) return;
      const selectedBars = props.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars))
        .filter(bar => props.selectedItemIds.has(bar.item.itemId) && pair.includes(bar.resource));
      const selectedResource = selectedBars.find(bar => bar.resource === lastSelected.current)?.resource ?? selectedBars[0]?.resource;
      changeSelection(selectedResource ?? top);
    } else if (!pair && canPair) {
      let previous: unknown;
      try { previous = JSON.parse(localStorage.getItem(partnerKey) ?? '{}')?.[top]; } catch { /* Storage is optional. */ }
      const partner = typeof previous === 'string' && previous !== top && enabled.includes(previous) ? previous
        : enabled[(enabled.indexOf(top) + 1) % enabled.length]!;
      changeSelection(`${top}+${partner}`);
    }
  };
  const shared = { ...props, machineMode: pair ? 2 as const : 1 as const, twoMachineDisabled: !canPair, onMachineModeChange };
  return pair
    ? <TwoMachineGantt {...shared} onSingleResourceChange={changeSelection} ref={ref} onToggleItem={(item, selected) => {
      if (selected) lastSelected.current = item.effectiveResourceCd ?? item.originalResourceCd;
      props.onToggleItem(item, selected);
    }} />
    : <PlanningBoardGanttView {...shared} ref={ref} />;
});
