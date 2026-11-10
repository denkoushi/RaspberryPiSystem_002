import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { pageZoom } from '../pageZoom';
import { PlanningBoardSingleResourcePicker } from '../PlanningBoardSingleResourcePicker';
import { planningBoardPair, planningBoardResourceMatches } from '../planningBoardTwoMachine';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';

import { planningBoardVisibleBars } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';

type Props = PlanningBoardGanttProps & { valueSheetResource?: string | null };

const TwoMachineGantt = forwardRef<PlanningBoardGanttHandle, Props>(function TwoMachineGantt(props, ref) {
  const candidates = props.resourceLanes ?? props.layout.groups.map(group => group.resource!).filter(Boolean);
  const resources = useMemo(() => planningBoardPair(props.singleResourceCd, props.resourceLanes)!, [props.singleResourceCd, props.resourceLanes]);
  const [chainOwner, setChainOwner] = useState<string | null>(null);
  const [chainTops, setChainTops] = useState<Record<string, { top: number | null; height: number }>>({});
  const onChainTopChange = useCallback((resource: string, top: number | null, height: number) => {
    setChainTops(current => current[resource]?.top === top && current[resource]?.height === height ? current : { ...current, [resource]: { top, height } });
  }, []);
  const [headContainer, setHeadContainer] = useState<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState<{ anchor: HTMLElement; index: number } | null>(null);
  useEffect(() => {
    if (props.machineSelectionLocked) setPicker(null);
  }, [props.machineSelectionLocked]);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
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
      if (container) setHeight(Math.max(0, Math.floor((window.innerHeight - container.getBoundingClientRect().top) / pageZoom() - 10)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (container?.parentElement) observer?.observe(container.parentElement);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [container]);
  const nextSelection = (resource: string) => {
    const next = [...resources];
    if (resource === resources[1 - picker!.index]) next.reverse();
    else next[picker!.index] = resource;
    return next.join('+');
  };
  return <div ref={setContainer} data-testid="planning-two-machine" className="relative mt-2 flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700" style={{ height }}>
    <div ref={setHeadContainer} className="shrink-0" />
    <div className="grid min-h-0 flex-1 grid-rows-2">
    {resources.map((resource, index) => <section key={resource} aria-label={resource}
      className={`flex min-h-0 overflow-hidden bg-slate-900 ${index ? 'border-t-4 border-slate-500' : ''}`}>
      <button type="button" aria-label={`${resource}の機械を選ぶ`} aria-expanded={picker?.index === index} disabled={props.machineSelectionLocked} onClick={(event) => { const anchor = event.currentTarget; if (!props.machineSelectionLocked) setPicker(current => current?.index === index ? null : { anchor, index }); }} className={`flex w-9 shrink-0 items-center gap-1.5 justify-center border-r border-slate-600 font-mono text-[22px] font-black tracking-[.1em] [writing-mode:vertical-rl] ${index ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-sky-300'}`}>{resource}<span className="text-xs">▼</span></button>
      <div className="min-h-0 min-w-0 flex-1">
        <PlanningBoardGanttView {...props} chainOwner={chainOwner} onChainFocus={setChainOwner} sharedChainTop={chainOwner ? chainTops[chainOwner]?.top : null} sharedChainHeight={chainOwner ? chainTops[chainOwner]?.height : 0} onChainTopChange={onChainTopChange} layout={resourceLayouts[index]!} fitPane singleResourceCd={resource} valueSheetContainer={container} sharedValueSheetOpen={props.valueSheetResource === resources[0]} resourceHeadContainer={index === 0 ? headContainer : undefined} hideResourceHead={index !== 0} onResourceMove={undefined} canMoveResource={undefined}
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
    {picker && !props.machineSelectionLocked && <PlanningBoardSingleResourcePicker placement="right" anchor={picker.anchor} resources={candidates}
      resourceCd={resources[picker.index]!} resourceNameMap={props.resourceNameMap}
      isDisabled={(resource) => resource.includes('+') || !isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource) || candidates.includes(nextSelection(resource))} onClose={() => setPicker(null)}
      onSelect={(resource) => {
        if (props.machineSelectionLocked || resource.includes('+') || !isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource) || candidates.includes(nextSelection(resource))) return;
        props.onSingleResourceChange?.(nextSelection(resource));
        setPicker(null);
      }} />}
  </div>;
});

export const PlanningBoardGanttDisplay = forwardRef<PlanningBoardGanttHandle, Props>(function PlanningBoardGanttDisplay(props, ref) {
  const resources = props.resourceLanes ?? (props.singleResourceCd ? props.layout.groups.map(group => group.resource!).filter(Boolean) : []);
  const pair = planningBoardPair(props.singleResourceCd, resources);
  const top = pair?.[0] ?? props.singleResourceCd;
  const enabled = resources.filter(resource => !resource.includes('+') && isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource)).sort();
  const partners = enabled.filter(resource => resource !== top && !resources.includes(`${top}+${resource}`));
  const canPair = Boolean(top && enabled.includes(top) && partners.length > 0);
  const partnerKey = `kiosk.planning-board.machine-partners:${props.preferenceScope ?? 'default'}`;
  const pendingModeFocus = useRef(false);
  const machineModeButtonRef = useCallback((button: HTMLButtonElement | null) => {
    if (button && pendingModeFocus.current) {
      button.focus();
      pendingModeFocus.current = false;
    }
  }, []);
  const lastSelected = useRef<string | null>(null);
  const changeSelection = (selection: string | null) => {
    const nextPair = planningBoardPair(selection, resources) ?? pair;
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
    if (props.machineSelectionLocked || !top) return;
    if (mode === 1) {
      if (!pair) return;
      const selectedBars = props.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars))
        .filter(bar => props.selectedItemIds.has(bar.item.itemId) && pair.includes(bar.resource));
      const selectedResource = selectedBars.find(bar => bar.resource === lastSelected.current)?.resource ?? selectedBars.find(bar => bar.resource === pair[0])?.resource ?? selectedBars[0]?.resource;
      pendingModeFocus.current = true;
      changeSelection(selectedResource ?? top);
    } else if (!pair && canPair) {
      let previous: unknown;
      try { previous = JSON.parse(localStorage.getItem(partnerKey) ?? '{}')?.[top]; } catch { /* Storage is optional. */ }
      const partner = typeof previous === 'string' && partners.includes(previous) ? previous
        : partners.find(resource => resource > top) ?? partners[0]!;
      pendingModeFocus.current = true;
      changeSelection(`${top}+${partner}`);
    }
  };
  const { capacityLoaded, unitSplitEnabledByResource, onSingleResourceChange, machineSelectionLocked } = props;
  const pairTop = pair?.[0];
  const pairBottom = pair?.[1];
  const topAvailable = Boolean(pairTop && resources.includes(pairTop));
  useEffect(() => {
    if (!machineSelectionLocked && capacityLoaded && pairTop && pairBottom && topAvailable
      && [pairTop, pairBottom].some(resource => !isPlanningBoardUnitSplitEnabled(resource, unitSplitEnabledByResource))) {
      onSingleResourceChange?.(pairTop);
    }
  }, [machineSelectionLocked, capacityLoaded, pairTop, pairBottom, topAvailable, unitSplitEnabledByResource, onSingleResourceChange]);
  const shared = { ...props, machineModeButtonRef, machineMode: pair ? 2 as const : 1 as const, machineSelectionLabel: pair ? `${pair[0]}+${pair[1]}` : undefined, twoMachineDisabled: !pair && !canPair, onMachineModeChange };
  return pair
    ? <TwoMachineGantt {...shared} onSingleResourceChange={changeSelection} ref={ref} onSelectedBarResource={(resource) => { lastSelected.current = resource; }} />
    : <PlanningBoardGanttView {...shared} ref={ref} />;
});
