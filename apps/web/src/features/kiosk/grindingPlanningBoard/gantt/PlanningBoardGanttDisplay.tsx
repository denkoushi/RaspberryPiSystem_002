import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { pageZoom } from '../pageZoom';
import { PlanningBoardSingleResourcePicker } from '../PlanningBoardSingleResourcePicker';
import { PlanningBoardTestBarDialog } from '../PlanningBoardTestBarDialog';
import { planningBoardPair, planningBoardResourceMatches } from '../planningBoardTwoMachine';
import { isPlanningBoardUnitSplitEnabled } from '../planningBoardUnitSplitPolicy';
import { compareProcessOrder } from '../sortGrindingPlanningBoardItems';

import { planningBoardHasPieceLinks } from './PlanningBoardChainLinks';
import { isNormalGanttBar, planningBoardVisibleBars } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';
import { planningBoardSeibanColor } from './planningBoardSeibanColor';
import { PlanningBoardSeibanLegend } from './PlanningBoardSeibanLegend';
import { PlanningBoardTwoMachineChainLinks, TwoMachineChainContext, type ChainPane } from './PlanningBoardTwoMachineChainLinks';
import { usePersistedPlanningBoardChainView } from './usePersistedPlanningBoardChainView';
import { usePlanningBoardDragPreview } from './usePlanningBoardSharedDrag';

import type { GanttBar } from './planningBoardGanttLayout';
import type { PlanningBoardGanttHandle, PlanningBoardGanttProps } from './planningBoardGanttViewTypes';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';
import type { SharedForwardDrag } from './usePlanningBoardSharedDrag';
import type { GrindingPlanningBoardBar } from '@raspi-system/shared-types';

type Props = PlanningBoardGanttProps & { valueSheetResource?: string | null };

const TwoMachineGantt = forwardRef<PlanningBoardGanttHandle, Props>(function TwoMachineGantt(props, ref) {
  const candidates = props.resourceLanes ?? props.layout.groups.map(group => group.resource!).filter(Boolean);
  const resources = useMemo(() => planningBoardPair(props.singleResourceCd, props.resourceLanes)!, [props.singleResourceCd, props.resourceLanes]);
  const [dragPreview, setDragPreview, dragPointer, subscribeDragPreview] = usePlanningBoardDragPreview();
  const paneDragLanes = useRef(new Map<string, readonly ForwardDragLane[]>());
  const dragLanes = useRef<readonly ForwardDragLane[]>([]);
  const registerDragLanes = useCallback((resource: string, lanes: readonly ForwardDragLane[] | null) => {
    if (lanes) paneDragLanes.current.set(resource, lanes); else paneDragLanes.current.delete(resource);
    dragLanes.current = [...paneDragLanes.current.values()].flat();
  }, []);
  const sharedDrag = useMemo<SharedForwardDrag>(() => ({ preview: dragPreview, setPreview: setDragPreview, pointer: dragPointer, subscribe: subscribeDragPreview,
    lanes: dragLanes, registerLanes: registerDragLanes }), [dragPreview, setDragPreview, dragPointer, subscribeDragPreview, registerDragLanes]);
  const [chainOwner, setChainOwner] = useState<string | null>(null);
  const [partKey, setPartKey] = useState<string | null>(null);
  const { view: chainView, changeView } = usePersistedPlanningBoardChainView();
  const [panes, setPanes] = useState<ReadonlyMap<string, ChainPane>>(new Map());
  const register = useCallback((resource: string, pane: ChainPane | null) => {
    setPanes(current => { const next = new Map(current); if (pane) next.set(resource, pane); else next.delete(resource); return next; });
  }, []);
  const focus = useCallback((key: string | null, resource: string | null) => { setPartKey(key); if (resource) setChainOwner(resource); }, []);
  const selectedTestResource = props.testBarControls?.selectedBar?.resourceCd;
  useEffect(() => { if (selectedTestResource) { setChainOwner(selectedTestResource); setPartKey(null); } }, [selectedTestResource, props.testBarControls?.selectedId]);
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
  const [valueSheetContainer, setValueSheetContainer] = useState<HTMLDivElement | null>(null);
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
  const resourceMinutesItems = useMemo(() => props.resourceMinutesItems ?? props.layout.groups.flatMap(group =>
    group.rows.flatMap(row => row.bars.filter(isNormalGanttBar).map(bar => bar.item))), [props.resourceMinutesItems, props.layout]);
  const paneBars = useMemo(() => resourceLayouts.map(planningBoardVisibleBars), [resourceLayouts]);
  const chainBars = useMemo(() => props.layout.mode === 'forward' && partKey && !props.pinMode && !selectedTestResource
    ? paneBars.flat().filter(isNormalGanttBar).filter(bar => bar.partKey === partKey)
      .sort((a, b) => compareProcessOrder(a.item.processOrder, b.item.processOrder) || (a.item.piecePosition ?? Infinity) - (b.item.piecePosition ?? Infinity) || a.item.itemId.localeCompare(b.item.itemId)) : [],
  [paneBars, partKey, props.layout.mode, props.pinMode, selectedTestResource]);
  useEffect(() => {
    if (partKey && !chainBars.some(bar => bar.resource === chainOwner)) { setPartKey(null); setChainOwner(null); }
  }, [partKey, chainBars, chainOwner]);
  const hasPieces = useMemo(() => planningBoardHasPieceLinks(chainBars), [chainBars]);
  const effectiveView = hasPieces ? chainView : 'process';
  const chainContext = useMemo(() => ({ partKey: chainBars.length ? partKey : null, focus, bars: chainBars, view: effectiveView, changeView, register }),
    [chainBars, partKey, focus, effectiveView, changeView, register]);
  const seibanColors = useMemo(() => {
    if (!props.colorBySeiban) return undefined;
    const seibanOrder = props.seibanOrder ?? [];
    const seibans = [...new Set(paneBars.flatMap(bars => bars.flatMap(bar => bar.item.kind === 'test' ? [] : [bar.item.fseiban])))];
    const rank = (seiban: string) => { const index = seibanOrder.indexOf(seiban); return index < 0 ? seibanOrder.length : index; };
    seibans.sort((a, b) => rank(a) - rank(b));
    return new Map(seibans.map(seiban => [seiban, planningBoardSeibanColor(seiban, seibanOrder)] as const));
  }, [props.colorBySeiban, props.seibanOrder, paneBars]);
  const { focusedSeiban, onFocusedSeibanChange } = props;
  useEffect(() => {
    if (focusedSeiban !== null && !seibanColors?.has(focusedSeiban)) onFocusedSeibanChange(null);
  }, [focusedSeiban, seibanColors, onFocusedSeibanChange]);
  const focusSeiban = (seiban: string) => {
    onFocusedSeibanChange(seiban);
    const barStart = (bar: GanttBar) => bar.segments?.[0]?.start ?? bar.start ?? bar.end ?? Infinity;
    paneBars.forEach((bars, index) => {
      const first = bars.filter(bar => bar.item.kind !== 'test' && bar.item.fseiban === seiban).reduce<GanttBar | undefined>(
        (earliest, bar) => !earliest || barStart(bar) < barStart(earliest) ? bar : earliest, undefined);
      if (first) handles.current.get(resources[index]!)?.scrollToItem(first.item.itemId);
    });
  };
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
  return <TwoMachineChainContext.Provider value={chainContext}><div ref={setContainer} data-testid="planning-two-machine" className="relative mt-2 flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-700" style={{ height }}>
    <div ref={setValueSheetContainer} className="relative flex min-h-0 flex-1 flex-col">
      <div ref={setHeadContainer} className="shrink-0" />
      <div className="grid min-h-0 flex-1 grid-rows-2">
      {resources.map((resource, index) => <section key={resource} aria-label={resource}
        className={`flex min-h-0 overflow-hidden bg-slate-900 ${index ? 'border-t-4 border-slate-500' : ''}`}>
        <button type="button" aria-label={`${resource}の機械を選ぶ`} aria-expanded={picker?.index === index} disabled={props.machineSelectionLocked} onClick={(event) => { const anchor = event.currentTarget; if (!props.machineSelectionLocked) setPicker(current => current?.index === index ? null : { anchor, index }); }} className="flex w-9 shrink-0 items-center gap-1.5 justify-center border-r border-slate-700 bg-[#0a1122] font-mono text-[22px] font-black tracking-[.1em] text-sky-300 [writing-mode:vertical-rl]">{resource}<span className="text-xs text-slate-400">▼</span></button>
        <div className="min-h-0 min-w-0 flex-1">
          <PlanningBoardGanttView {...props} chainOwner={chainOwner} onClearChain={() => { setChainOwner(null); setPartKey(null); }} onChainFocus={setChainOwner} sharedChainTop={chainOwner ? chainTops[chainOwner]?.top : null} sharedChainHeight={chainOwner ? chainTops[chainOwner]?.height : 0} onChainTopChange={onChainTopChange} layout={resourceLayouts[index]!} fitPane singleResourceCd={resource} minutesResourceCds={resources} resourceMinutesItems={resourceMinutesItems} valueSheetContainer={valueSheetContainer} sharedSeibanLegend sharedValueSheetOpen={props.valueSheetResource === resources[0]} resourceHeadContainer={index === 0 ? headContainer : undefined} hideResourceHead={index !== 0} sharedDrag={sharedDrag}
            ref={(handle) => { if (handle) handles.current.set(resource, handle); else handles.current.delete(resource); }}
            valueSheetOpen={index === 0 && props.valueSheetResource === resource} onToggleValueSheet={() => props.onToggleValueSheet?.(resource)}
            onNavigateBar={(bar) => {
              if (!planningBoardResourceMatches(props.singleResourceCd!, bar.resource)) return false;
              handles.current.get(bar.resource)?.scrollToItem(bar.item.itemId);
              // Keep navigation within two-machine mode even when an elapsed row cannot be scrolled to.
              return true;
            }} />
        </div>
      </section>)}
      </div>
    </div>
    {picker && !props.machineSelectionLocked && <PlanningBoardSingleResourcePicker placement="right" anchor={picker.anchor} resources={candidates}
      resourceCd={resources[picker.index]!} resourceNameMap={props.resourceNameMap}
      isDisabled={(resource) => resource.includes('+') || !isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource) || candidates.includes(nextSelection(resource))} onClose={() => setPicker(null)}
      onSelect={(resource) => {
        if (props.machineSelectionLocked || resource.includes('+') || !isPlanningBoardUnitSplitEnabled(resource, props.unitSplitEnabledByResource) || candidates.includes(nextSelection(resource))) return;
        props.onSingleResourceChange?.(nextSelection(resource));
        setPicker(null);
      }} />}
    <PlanningBoardTwoMachineChainLinks container={container} panes={panes} bars={chainBars} view={effectiveView} />
    {seibanColors && <PlanningBoardSeibanLegend seibanColors={seibanColors} focusedSeiban={focusedSeiban}
      onFocusedSeibanChange={onFocusedSeibanChange} onFocusSeiban={focusSeiban} />}
  </div></TwoMachineChainContext.Provider>;
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
  const [testDialog, setTestDialog] = useState<{ resources: string[]; after?: GrindingPlanningBoardBar; initial: string } | null>(null);
  const testAnchor = useRef<GrindingPlanningBoardBar | null>(null);
  const onTestBarAnchorChange = useCallback((item: GrindingPlanningBoardBar | null) => { testAnchor.current = item; }, []);
  const openTestDialog = () => {
    const shown = pair ?? (props.singleResourceCd ? [props.singleResourceCd] : []);
    if (!shown.length || !props.testBarControls || props.testBarControls.disabled) return;
    const selected = props.testBarControls.selectedBar ?? testAnchor.current ?? props.layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))
      .find((bar) => props.selectedItemIds.has(bar.item.itemId))?.item;
    const resource = selected?.kind === 'test' ? selected.resourceCd : selected?.effectiveResourceCd ?? selected?.originalResourceCd;
    setTestDialog({ resources: shown, after: selected?.isCompleted ? undefined : selected, initial: resource && shown.includes(resource) ? resource : shown[0]! });
  };
  const shared = { ...props, onTestBarAnchorChange, onTestBarAdd: props.testBarCreationEnabled && props.layout.mode === 'forward' ? openTestDialog : undefined, machineModeButtonRef, machineMode: pair ? 2 as const : 1 as const, machineSelectionLabel: pair ? `${pair[0]}+${pair[1]}` : undefined, twoMachineDisabled: !pair && !canPair, onMachineModeChange };
  return <> {pair
    ? <TwoMachineGantt {...shared} onSingleResourceChange={changeSelection} ref={ref} onSelectedBarResource={(resource) => { lastSelected.current = resource; }} />
    : <PlanningBoardGanttView {...shared} ref={ref} />}
    {testDialog && props.testBarControls && <PlanningBoardTestBarDialog sequence={props.testBarControls.nextSequence} resources={testDialog.resources} initialResource={testDialog.initial}
      onClose={() => setTestDialog(null)} onInsert={(resource, minutes) => props.testBarControls!.create(resource, minutes, testDialog.after)} />}
  </>;
});
