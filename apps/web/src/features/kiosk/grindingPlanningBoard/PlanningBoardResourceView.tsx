import { useMemo } from 'react';


import { PlanningBoardItemTable } from './PlanningBoardItemTable';
import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardLoad } from '@raspi-system/shared-types';

export type PlanningBoardResourceViewProps = {
  items: readonly GrindingPlanningBoardItem[];
  seibanOrder: readonly string[];
  resources: readonly string[];
  load: readonly GrindingPlanningBoardLoad[];
  allocation: PlanningBoardAllocation;
  selectedItemIds: ReadonlySet<string>;
  onToggleItem: (item: GrindingPlanningBoardItem, selected: boolean) => void;
  onResourceClick: (item: GrindingPlanningBoardItem) => void;
  onRankChange?: (item: GrindingPlanningBoardItem, rank: number | null) => void;
  disabled?: boolean;
};

export function PlanningBoardResourceView({
  items,
  seibanOrder,
  resources,
  load,
  allocation,
  selectedItemIds,
  onToggleItem,
  onResourceClick,
  onRankChange,
  disabled = false
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

  const loadByResource = useMemo(() => new Map(load.map((entry) => [entry.resourceCd, entry])), [load]);

  const formatLoad = (resource: string) => {
    const summary = loadByResource.get(resource);
    if (!summary) return '負荷未取得';
    const count = allocation === 'original' ? summary.originalItemCount : summary.alternateItemCount;
    const unknown = allocation === 'original' ? summary.originalUnknownItemCount : summary.alternateUnknownItemCount;
    const minutes = allocation === 'original' ? summary.originalRequiredMinutes : summary.alternateRequiredMinutes;
    const time = unknown > 0
      ? `${minutes == null ? '時間未定' : `${minutes}分`} + 不明${unknown}件`
      : `${minutes ?? 0}分`;
    return `未完${count}件 · ${time}`;
  };

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-2.5 lg:grid-cols-2 xl:grid-cols-3" data-testid="planning-board-resource-view">
      {groups.map(([resource, resourceItems]) => {
        return (
          <article key={resource} className="min-w-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/85">
            <header className="flex min-h-14 items-center justify-between gap-2 border-b border-slate-800 px-2.5 py-2">
              <strong className="font-mono text-sm text-white">資源CD {resource}</strong>
              <span className="text-[11px] text-slate-400">{formatLoad(resource)}</span>
            </header>
            <PlanningBoardItemTable
              items={resourceItems}
              allocation={allocation}
              selectedItemIds={selectedItemIds}
              onToggleItem={onToggleItem}
              onResourceClick={onResourceClick}
              onRankChange={onRankChange}
              disabled={disabled}
              showRank
              showSeiban
              tableLabel={`資源CD ${resource}の工程アイテム`}
            />
          </article>
        );
      })}
    </div>
  );
}
