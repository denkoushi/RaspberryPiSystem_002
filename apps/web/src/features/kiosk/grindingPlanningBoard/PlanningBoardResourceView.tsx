import { useMemo } from 'react';


import { formatResourceCdWithJapaneseNames } from '../leaderOrderBoard/formatResourceCdWithJapaneseNames';

import { PlanningBoardItemTable } from './PlanningBoardItemTable';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export type PlanningBoardResourceViewProps = {
  items: readonly GrindingPlanningBoardItem[];
  seibanOrder: readonly string[];
  resources: readonly string[];
  resourceNameMap: Record<string, string[]>;
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  disabled?: boolean;
  rankDisabled?: boolean | ((item: GrindingPlanningBoardItem) => boolean);
};

export function PlanningBoardResourceView({
  items,
  seibanOrder,
  resources,
  resourceNameMap,
  allocation,
  selectedItemIds,
  onToggleItem,
  onResourceClick,
  onRankChange,
  disabled = false,
  rankDisabled = false
}: PlanningBoardResourceViewProps) {
  const groups = useMemo(() => {
    const byResource = new Map<string, GrindingPlanningBoardItem[]>();
    for (const resource of resources) byResource.set(resource, []);
    for (const item of items) {
      const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
      const group = byResource.get(resource) ?? [];
      group.push(item);
      byResource.set(resource, group);
    }
    return [...byResource.entries()]
      .filter(([, resourceItems]) => resourceItems.length > 0)
      .map(([resource, resourceItems]) => [
        resource,
        sortGrindingPlanningBoardItems(resourceItems, seibanOrder, 'resource', allocation)
      ] as const);
  }, [allocation, items, resources, seibanOrder]);

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-2.5 lg:grid-cols-2 xl:grid-cols-3" data-testid="planning-board-resource-view">
      {groups.map(([resource, resourceItems]) => {
        return (
          <article key={resource} className="min-w-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/85">
            <header className="flex h-7 min-h-7 min-w-0 items-center gap-2 border-b border-slate-800 px-2 py-0.5">
              <strong className="min-w-0 flex-1 truncate font-mono text-[15px] leading-none text-white">
                {formatResourceCdWithJapaneseNames(resource, resourceNameMap)}
              </strong>
            </header>
            <PlanningBoardItemTable
              items={resourceItems}
              allocation={allocation}
              selectedItemIds={selectedItemIds}
              onToggleItem={onToggleItem}
              onResourceClick={onResourceClick}
              onRankChange={onRankChange}
              disabled={disabled}
              rankDisabled={rankDisabled}
              showRank
              showSeiban
              showColumnHeaders={false}
              tableLabel={`資源CD ${resource}の工程アイテム`}
            />
          </article>
        );
      })}
    </div>
  );
}
