import { useCallback, useLayoutEffect, useRef } from 'react';

import { PlanningBoardGanttDisplay } from './gantt/PlanningBoardGanttDisplay';
import { PlanningBoardFocusView } from './PlanningBoardFocusView';
import { PlanningBoardResourceView } from './PlanningBoardResourceView';
import { PlanningBoardSeibanPane } from './PlanningBoardSeibanPane';

import type { usePlanningBoardGantt } from './gantt/usePlanningBoardGantt';
import type { OrderPreview } from './planningBoardPageModel';
import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderPlacement, GrindingPlanningBoardResponse, GrindingPlanningBoardSpecialDueKind, GrindingPlanningBoardView } from '@raspi-system/shared-types';
import type { SyntheticEvent } from 'react';

type Props = {
  data: GrindingPlanningBoardResponse | undefined;
  ganttEnabled: boolean;
  focusedSeiban: string | null;
  setFocusedSeiban: (fseiban: string | null) => void;
  colorBySeiban: boolean;
  registeredFseibans: string[];
  gantt: ReturnType<typeof usePlanningBoardGantt>;
  ganttLayout: ReturnType<typeof usePlanningBoardGantt>['layout'];
  view: GrindingPlanningBoardView;
  orderPreview: OrderPreview | null;
  category: GrindingPlanningBoardCategory;
  resourcesQuery: { data?: { resourceNameMap: Record<string, string[]> } };
  pinMode: boolean;
  togglePin: (item: GrindingPlanningBoardItem) => void;
  selectedItemIds: ReadonlySet<string>;
  toggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  toggleCompletion: (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete') => Promise<void>;
  completionPendingItemIds: ReadonlySet<string>;
  onArrivalChange?: (item: GrindingPlanningBoardItem, recorded: boolean) => void;
  onFirstProcessArrivalChange?: (item: GrindingPlanningBoardItem, state: NonNullable<GrindingPlanningBoardItem['firstProcessState']> | null) => void;
  arrivalPending?: boolean;
  arrivalError?: boolean;
  moveDueByDrag: (item: GrindingPlanningBoardItem, date: string) => void;
  reorderResourceByDrag: (item: GrindingPlanningBoardItem, targetItem: GrindingPlanningBoardItem, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
  moveResourceInGantt: (item: GrindingPlanningBoardItem, targetResource: string, targetItem: GrindingPlanningBoardItem | null, placement: GrindingPlanningBoardResourceOrderPlacement) => void;
  canMoveResource: (item: GrindingPlanningBoardItem, resource: string) => boolean;
  interactionLocked: boolean;
  writeQueue: { pending: boolean };
  allocation: PlanningBoardAllocation;
  writeBlocked: boolean;
  piecesWriting: boolean;
  rankMutationReady: boolean;
  focusedFseiban: string | null;
  focusItems: GrindingPlanningBoardItem[];
  machineNames: Map<string, string | null>;
  returnFromFocus: () => void;
  toggleFocusAll: (selected: boolean) => void;
  openEditorForItem: (item: GrindingPlanningBoardItem) => void;
  changeRank: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  rankDisabled: (item: GrindingPlanningBoardItem) => boolean;
  bulkReady: boolean;
  activeFseibans: ReadonlySet<string>;
  itemsBySeiban: Map<string, GrindingPlanningBoardItem[]>;
  paneActionsBySeiban: Map<string, { onToggleOpen: () => void; onFocus: () => void; onToggleAll: (selected: boolean) => void }>;
  sortedItemsBySeiban: Map<string, GrindingPlanningBoardItem[]>;
  openFseibans: ReadonlySet<string>;
  scanFocusKey: number;
  visibleItems: GrindingPlanningBoardItem[];
  moveResourceByDrag: (item: GrindingPlanningBoardItem, targetResource: string) => void;
  specialDueMode: GrindingPlanningBoardSpecialDueKind | null;
  updateSpecialDue: (item: GrindingPlanningBoardItem) => void;
  nowMs: number;
  resourceDragDisabled: boolean;
};

export function PlanningBoardPageView({
  data, ganttEnabled, focusedSeiban, setFocusedSeiban, colorBySeiban, registeredFseibans, gantt, ganttLayout,
  view, orderPreview, category, resourcesQuery, pinMode, togglePin, selectedItemIds, toggleItem,
  toggleCompletion, completionPendingItemIds, onArrivalChange, onFirstProcessArrivalChange, arrivalPending, arrivalError, moveDueByDrag, reorderResourceByDrag, moveResourceInGantt,
  canMoveResource, interactionLocked, writeQueue, allocation, writeBlocked, piecesWriting, rankMutationReady,
  focusedFseiban, focusItems, machineNames, returnFromFocus, toggleFocusAll, openEditorForItem,
  changeRank, rankDisabled, bulkReady, activeFseibans, itemsBySeiban, paneActionsBySeiban,
  sortedItemsBySeiban, openFseibans, scanFocusKey, visibleItems, moveResourceByDrag, specialDueMode,
  updateSpecialDue, nowMs, resourceDragDisabled
}: Props) {
  const writingRef = useRef(piecesWriting);
  useLayoutEffect(() => { writingRef.current = piecesWriting; }, [piecesWriting]);
  // Only write controls in this DOM subtree are gated. Portaled rank choices
  // use the table's stable handler; dialogs and navigation remain interactive.
  const guardWriteControl = useCallback((event: SyntheticEvent<HTMLDivElement>) => {
    if (!writingRef.current || !(event.target instanceof Element) ||
      !event.currentTarget.contains(event.target) || !event.target.closest('[data-planning-board-piece-write]')) return;
    if ('key' in event && (event.key === 'Escape' || event.key === 'Tab')) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const content = (
    <>
      {data && ganttEnabled ? (
        <PlanningBoardGanttDisplay resourceLanes={gantt.singleResourceLanes} unitSplitEnabledByResource={gantt.unitSplitEnabledByResource} resourceMinutesItems={gantt.resourceMinutesItems} resourceMinutes={gantt.resourceMinutes} minutesPending={gantt.minutesPending} minutesError={gantt.minutesError}
          onMinutesSourceChange={gantt.changeMinutesSource} valueSheetResource={gantt.valueSheetResource} valueSheetOpen={gantt.valueSheetOpen} onToggleValueSheet={gantt.toggleValueSheet} focusedSeiban={focusedSeiban} onFocusedSeibanChange={setFocusedSeiban} colorBySeiban={colorBySeiban} seibanOrder={registeredFseibans} ref={gantt.viewRef} layout={ganttLayout} scale={gantt.scale} homeKey={gantt.homeKey}
          singleResourceCd={gantt.singleResourceCd} onSingleResourceChange={gantt.changeSingleResource} onOpenSingleResourcePicker={gantt.openSingleResourcePicker} singleResourcePickerOpen={Boolean(gantt.singleResourcePickerAnchor)}
          resourceView={Boolean(gantt.singleResourceCd) || view === 'resource'} dailyHoursByResource={orderPreview?.options.dailyHoursByResource ?? gantt.dailyHoursByResource} preferenceScope={`${data.siteKey}:${category}`}
          resourceNameMap={resourcesQuery.data?.resourceNameMap ?? {}}
          runsThroughBreaks={orderPreview?.options.runsThroughBreaks ?? gantt.runsThroughBreaks} onBreaksChange={gantt.changeBreaks}
          capacityPending={gantt.capacityPending} capacityError={gantt.capacityError} onCapacityChange={gantt.changeCapacity}
          onArrivalChange={onArrivalChange} onFirstProcessArrivalChange={onFirstProcessArrivalChange} arrivalPending={arrivalPending} arrivalError={arrivalError}
          pinMode={gantt.mode === 'forward' && (Boolean(gantt.singleResourceCd) || view === 'resource') && pinMode} onTogglePin={togglePin}
          selectedItemIds={selectedItemIds} onToggleItem={toggleItem} onCompleteToggle={toggleCompletion} completionPendingItemIds={completionPendingItemIds} onDueDrop={moveDueByDrag} onResourceReorder={reorderResourceByDrag}
          onResourceMove={moveResourceInGantt} canMoveResource={(item, resource) => data.resources.includes(resource) && canMoveResource(item, resource)}
          pieceDisabled={allocation === 'original' || writeBlocked || Boolean(specialDueMode)}
          disabled={interactionLocked || (pinMode && writeQueue.pending)} dragDisabled={allocation !== 'alternate' || writeBlocked || interactionLocked || !rankMutationReady} />
      ) : data && view === 'seiban' && focusedFseiban && focusItems.length > 0 ? (
        <div className="mt-2">
          <PlanningBoardFocusView
            fseiban={focusedFseiban}
            machineName={machineNames.get(focusedFseiban) ?? null}
            items={focusItems}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onBack={returnFromFocus}
            onToggleAll={toggleFocusAll}
            onToggleItem={toggleItem} onCompleteToggle={toggleCompletion} completionPendingItemIds={completionPendingItemIds}
            onResourceClick={openEditorForItem}
            onRankChange={changeRank}
            disabled={interactionLocked}
            rankDisabled={rankDisabled}
            bulkDisabled={!bulkReady}
          />
        </div>
      ) : data && view === 'seiban' ? (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          {registeredFseibans.filter((fseiban) => activeFseibans.has(fseiban)).map((fseiban) => {
            const group = itemsBySeiban.get(fseiban) ?? [];
            if (group.length === 0) return null;
            const actions = paneActionsBySeiban.get(fseiban);
            if (!actions) return null;
            return (
              <PlanningBoardSeibanPane
                key={fseiban}
                fseiban={fseiban}
                machineName={machineNames.get(fseiban) ?? null}
                items={sortedItemsBySeiban.get(fseiban) ?? group}
                allocation={allocation}
                selectedItemIds={selectedItemIds}
                isOpen={openFseibans.has(fseiban)}
                isFocused={false}
                highlighted={focusedSeiban === fseiban}
                scanFocusKey={scanFocusKey}
                onToggleOpen={actions.onToggleOpen}
                onFocus={actions.onFocus}
                onToggleAll={actions.onToggleAll}
                onToggleItem={toggleItem} onCompleteToggle={toggleCompletion} completionPendingItemIds={completionPendingItemIds}
                onResourceClick={openEditorForItem}
                onRankChange={changeRank}
                disabled={interactionLocked}
                rankDisabled={rankDisabled}
                bulkDisabled={!bulkReady}
              />
            );
          })}
        </div>
      ) : data ? (
        <div className="mt-2">
          <PlanningBoardResourceView
            preferenceScope={`${data.siteKey}:${category}`}
            items={visibleItems}
            focusedSeiban={focusedSeiban}
            scanFocusKey={scanFocusKey}
            seibanOrder={registeredFseibans}
            resources={data.resources}
            category={category}
            resourceCategories={data.resourceCategories}
            canMoveResource={canMoveResource}
            resourceNameMap={resourcesQuery.data?.resourceNameMap ?? {}}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onToggleItem={toggleItem} onCompleteToggle={toggleCompletion} completionPendingItemIds={completionPendingItemIds}
            onResourceClick={openEditorForItem}
            onResourceDrop={moveResourceByDrag}
            onResourceReorder={reorderResourceByDrag}
            onRankChange={changeRank}
            specialDueMode={specialDueMode}
            onSpecialDueClick={updateSpecialDue}
            nowMs={nowMs}
            disabled={interactionLocked}
            resourceDragDisabled={resourceDragDisabled}
            bulkDisabled={!bulkReady}
            rankDisabled={rankDisabled}
          />
        </div>
      ) : null}
    </>
  );
  return <div data-planning-board-pieces-writing={piecesWriting} aria-busy={piecesWriting || undefined} className="contents
    [&[data-planning-board-pieces-writing=true]_[data-planning-board-piece-write=rank]]:opacity-55
    [&[data-planning-board-pieces-writing=true]_[data-planning-board-piece-write=rank]]:cursor-not-allowed
    [&[data-planning-board-pieces-writing=true]_[data-planning-board-piece-write=completion]]:opacity-60
    [&[data-planning-board-pieces-writing=true]_[data-planning-board-piece-write=resource]]:!cursor-default"
    onClickCapture={guardWriteControl} onChangeCapture={guardWriteControl}
    onPointerDownCapture={guardWriteControl} onKeyDownCapture={guardWriteControl}>
    {content}
  </div>;
}
