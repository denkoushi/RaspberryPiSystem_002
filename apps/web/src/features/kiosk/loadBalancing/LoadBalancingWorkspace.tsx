import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useKioskProductionScheduleLoadBalancingWorkspace,
  useKioskProductionScheduleResources,
  usePutKioskProductionScheduleLoadBalancingCapacityBase
} from '../../../api/hooks';

import { LoadBalancingCellDetail } from './LoadBalancingCellDetail';
import { addMonths, currentYearMonth, formatHours, formatYearMonthSlash } from './loadBalancingFormat';
import { LoadBalancingHeatmap, type HeatmapResourceRow, type HeatmapSelection } from './LoadBalancingHeatmap';
import { LoadBalancingOutsourcePanel } from './LoadBalancingOutsourcePanel';
import {
  LATE_BUCKET,
  buildLoadMatrix,
  listCellRows,
  readCapacity,
  readLoad,
  sumOverMinutes,
  type LoadMatrix,
  type ScenarioAction,
  type ScenarioResult,
  type ScenarioInput,
  transferOptions,
  outsourceOption,
  applyOutsource,
  cancelScenarioRow,
  summarizeScenarioActions
} from './loadBalancingScenario';
import { LoadBalancingScenarioBar } from './LoadBalancingScenarioBar';
import { LoadBalancingUnallocatedPanel } from './LoadBalancingUnallocatedPanel';
import { resolveLoadBalancingResourceDisplayName } from './resolveLoadBalancingResourceDisplayName';

import type {
  ProductionScheduleLoadBalancingWorkspaceResource,
  ProductionScheduleLoadBalancingWorkspaceResponse
} from '../../../api/client';

const SPAN_MONTHS = 6;
const MAX_OFFSET = 6;
const EMPTY_ACTIONS: ScenarioAction[] = [];

export function useLoadBalancingWorkspaceState({
  scopeParams,
  scopeEnabled,
  dueSource
}: {
  scopeParams: { targetDeviceScopeKey?: string };
  scopeEnabled: boolean;
  dueSource: 'excel' | 'scaw';
}) {
  const thisMonth = useMemo(() => currentYearMonth(), []);
  const [offset, setOffset] = useState(0);
  const fromMonth = addMonths(thisMonth, offset);
  const toMonth = addMonths(fromMonth, SPAN_MONTHS - 1);
  const scopeKey = `${dueSource}|${fromMonth}|${scopeParams.targetDeviceScopeKey ?? ''}`;

  const query = useKioskProductionScheduleLoadBalancingWorkspace(
    { fromMonth, toMonth, dueSource, ...scopeParams },
    { enabled: scopeEnabled }
  );
  const scenarioKey = `${scopeKey}|${JSON.stringify(query.data?.outsourceSettings)}`;
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch: !scopeEnabled });
  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );

  const [scenario, setScenario] = useState<{ key: string; result: ScenarioResult; history: ScenarioResult[] }>({ key: scenarioKey, result: { actions: [], noTaker: [] }, history: [] });
  const result = scenario.key === scenarioKey ? scenario.result : { actions: EMPTY_ACTIONS, noTaker: [] };
  const commitResult = useCallback((next: ScenarioResult) => setScenario((current) => {
    const currentResult = current.key === scenarioKey ? current.result : { actions: [], noTaker: [] };
    if (current.key === scenarioKey && JSON.stringify(currentResult) === JSON.stringify(next)) return current;
    return {
      key: scenarioKey, result: next,
      history: [...(current.key === scenarioKey ? current.history : []), currentResult]
    };
  }), [scenarioKey]);
  const undo = () => setScenario((current) => {
    if (current.key !== scenarioKey || !current.history.length) return current;
    const previous = current.history[current.history.length - 1]!;
    return {
      ...current,
      result: previous,
      history: current.history.slice(0, -1)
    };
  });

  return {
    thisMonth,
    offset,
    setOffset: (next: number) => setOffset(Math.min(MAX_OFFSET, Math.max(0, next))),
    fromMonth,
    toMonth,
    query,
    resourceNameMap,
    actions: result.actions,
    result,
    commitResult,
    undo,
    reset: () => setScenario({ key: scenarioKey, result: { actions: [], noTaker: [] }, history: [] }),
    canUndo: scenario.key === scenarioKey && scenario.history.length > 0
  };
}

type WorkspaceViewProps = {
  data: ProductionScheduleLoadBalancingWorkspaceResponse;
  workspaceSummary: ReturnType<typeof computeWorkspaceSummary>;
  formattedMachineNames: Map<string, string>;
  thisMonth: string;
  resourceNameMap: Record<string, string[]>;
  actions: ScenarioAction[];
  commitResult: (result: ScenarioResult) => void;
  noTaker: ScenarioResult['noTaker'];
  machine: string;
  highlightUnset: boolean;
  panel: 'cell' | 'unallocated';
  onClosePanel: () => void;
  scopeParams: { targetDeviceScopeKey?: string };
};

export function computeWorkspaceSummary(
  data: ProductionScheduleLoadBalancingWorkspaceResponse,
  actions: ScenarioAction[],
  baseMatrix = buildLoadMatrix(data.rows, [], data.months)
) {
  const matrix = actions.length > 0 ? buildLoadMatrix(data.rows, actions, data.months) : baseMatrix;
  const before = sumOverMinutes(baseMatrix, data.resources, data.months);
  const after = sumOverMinutes(matrix, data.resources, data.months);
  let lateMinutes = 0;
  matrix.forEach((perResource) => {
    lateMinutes += perResource.get(LATE_BUCKET) ?? 0;
  });
  const unsetCount = data.resources.filter(
    (resource) => hasAnyLoad(baseMatrix, resource.resourceCd) && isCapacityUnset(resource, data.months)
  ).length;
  return { baseMatrix, matrix, before, after, lateMinutes, unsetCount };
}

function isCapacityUnset(resource: ProductionScheduleLoadBalancingWorkspaceResource, months: string[]): boolean {
  return months.every((month) => resource.capacityByMonth[month] == null);
}

function hasAnyLoad(matrix: LoadMatrix, resourceCd: string): boolean {
  const perResource = matrix.get(resourceCd);
  if (!perResource) return false;
  for (const minutes of perResource.values()) {
    if (minutes >= 30) return true;
  }
  return false;
}

export function LoadBalancingWorkspaceView({
  data,
  workspaceSummary,
  formattedMachineNames,
  thisMonth,
  resourceNameMap,
  actions,
  commitResult,
  noTaker,
  machine,
  highlightUnset,
  panel,
  onClosePanel,
  scopeParams
}: WorkspaceViewProps) {
  const buckets = useMemo(() => [LATE_BUCKET, ...data.months], [data.months]);
  const { baseMatrix, matrix, before, after } = workspaceSummary;
  const input: ScenarioInput = { rows: data.rows, months: data.months, actions, resources: data.resources, rules: data.transferRules, settings: data.outsourceSettings, today: data.today, machine };
  const commitActions = (next: ScenarioAction[]) => {
    if (JSON.stringify(next) === JSON.stringify(actions)) return;
    commitResult({ actions: next, noTaker: noTaker.filter((item) => !next.some((action) => action.rowId === item.rowId)) });
  };
  const undoRow = (rowId: string) => commitActions(cancelScenarioRow(actions, rowId));
  const machineRows = useMemo(
    () => (machine ? data.rows.filter((row) => formattedMachineNames.get(row.machineName) === machine) : null),
    [data.rows, formattedMachineNames, machine]
  );
  const machineMatrix = useMemo(
    () => (machineRows ? buildLoadMatrix(machineRows, actions, data.months) : null),
    [actions, data.months, machineRows]
  );

  const heatmapRows: HeatmapResourceRow[] = useMemo(() => {
    const visible = data.resources.filter(
      (resource) => hasAnyLoad(baseMatrix, resource.resourceCd) || hasAnyLoad(matrix, resource.resourceCd)
    );
    const peak = (resource: ProductionScheduleLoadBalancingWorkspaceResource) => {
      let best = -1;
      for (const month of data.months) {
        const capacity = readCapacity(resource, month);
        if (capacity == null || capacity <= 0) continue;
        best = Math.max(best, readLoad(baseMatrix, resource.resourceCd, month) / capacity);
      }
      return best;
    };
    const total = (resourceCd: string) =>
      [...(baseMatrix.get(resourceCd)?.values() ?? [])].reduce((sum, minutes) => sum + minutes, 0);
    return visible
      .map((resource) => ({ resource, peak: peak(resource) }))
      .sort((a, b) => b.peak - a.peak || total(b.resource.resourceCd) - total(a.resource.resourceCd))
      .map(({ resource }) => ({
        resource,
        displayName: resolveLoadBalancingResourceDisplayName(resource.resourceCd, resourceNameMap)
      }));
    // 並びは baseMatrix で決める（試算で行が動いて見失わないように）
  }, [data, baseMatrix, matrix, resourceNameMap]);

  const [selected, setSelected] = useState<HeatmapSelection | null>(null);
  const effectiveSelected = useMemo(() => {
    if (selected && heatmapRows.some((row) => row.resource.resourceCd === selected.resourceCd)) return selected;
    return pickWorstCell(heatmapRows, data.months, baseMatrix);
  }, [baseMatrix, data.months, heatmapRows, selected]);

  const [editingCapacityCd, setEditingCapacityCd] = useState<string | null>(null);
  const capacityMutation = usePutKioskProductionScheduleLoadBalancingCapacityBase();

  const selectedResource = data.resources.find((resource) => resource.resourceCd === effectiveSelected?.resourceCd);
  // 矢印キーでセル移動（入力中は除く）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"]')) return;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (!effectiveSelected) return;
      const rowIndex = heatmapRows.findIndex((row) => row.resource.resourceCd === effectiveSelected.resourceCd);
      const colIndex = buckets.indexOf(effectiveSelected.bucket);
      let nextRow = rowIndex;
      let nextCol = colIndex;
      if (event.key === 'ArrowDown') nextRow = Math.min(heatmapRows.length - 1, rowIndex + 1);
      else if (event.key === 'ArrowUp') nextRow = Math.max(0, rowIndex - 1);
      else if (event.key === 'ArrowRight') nextCol = Math.min(buckets.length - 1, colIndex + 1);
      else if (event.key === 'ArrowLeft') nextCol = Math.max(0, colIndex - 1);
      else return;
      event.preventDefault();
      setSelected({ resourceCd: heatmapRows[nextRow]!.resource.resourceCd, bucket: buckets[nextCol]! });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [buckets, effectiveSelected, heatmapRows]);

  const cellRows = useMemo(() => {
    if (!effectiveSelected) return [];
    return listCellRows({
      rows: machineRows ?? data.rows,
      actions,
      months: data.months,
      resourceCd: effectiveSelected.resourceCd,
      bucket: effectiveSelected.bucket
    });
  }, [actions, data.months, data.rows, effectiveSelected, machineRows]);

  const handleEditCapacity = (resourceCd: string) => {
    capacityMutation.reset();
    setEditingCapacityCd(resourceCd);
    if (effectiveSelected?.resourceCd !== resourceCd) {
      setSelected({ resourceCd, bucket: data.months[0]! });
    }
  };

  const heatmap = (
    <LoadBalancingHeatmap
      rows={heatmapRows}
      buckets={buckets}
      currentMonth={thisMonth}
      matrix={matrix}
      baseMatrix={baseMatrix}
      machineMatrix={machineMatrix}
      selected={effectiveSelected}
      highlightUnset={highlightUnset}
      onSelect={(selection) => {
        setSelected(selection);
        setEditingCapacityCd(null);
        onClosePanel();
      }}
      onEditCapacity={(resourceCd) => {
        onClosePanel();
        handleEditCapacity(resourceCd);
      }}
    />
  );

  const summary = useMemo(() => summarizeScenarioActions(data.rows, actions), [data.rows, actions]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] gap-2">
      <div className="grid min-h-0 grid-rows-[minmax(0,0.9fr)_minmax(0,1fr)] gap-2">
      <section className="flex min-h-0 flex-col rounded-[10px] border border-white/15 bg-slate-900/70">
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {heatmapRows.length === 0 ? (
            <p className="p-6 text-white/55">この期間の未完了負荷はありません</p>
          ) : (
            heatmap
          )}
        </div>
        <HeatmapLegend />
        <LoadBalancingScenarioBar
          summary={summary}
          overBeforeMinutes={before.overMinutes}
          overAfterMinutes={after.overMinutes}
        />
      </section>

      {panel === 'unallocated' ? (
        <LoadBalancingUnallocatedPanel rows={data.unallocatedRows} onClose={onClosePanel} />
      ) : selectedResource && effectiveSelected ? (
        <LoadBalancingCellDetail
          key={`${effectiveSelected.resourceCd}|${effectiveSelected.bucket}`}
          resource={selectedResource}
          displayName={resolveLoadBalancingResourceDisplayName(selectedResource.resourceCd, resourceNameMap)}
          bucket={effectiveSelected.bucket}
          loadMinutes={readLoad(matrix, effectiveSelected.resourceCd, effectiveSelected.bucket)}
          capacityMinutes={readCapacity(selectedResource, effectiveSelected.bucket)}
          cellRows={cellRows}
          formattedMachineNames={formattedMachineNames}
          canTransfer={Boolean(selectedResource.classCode) && effectiveSelected.bucket !== LATE_BUCKET}
          editingCapacity={editingCapacityCd === selectedResource.resourceCd}
          capacitySaving={capacityMutation.isPending}
          capacityError={capacityMutation.error ? '保存できませんでした' : null}
          onEditCapacity={() => handleEditCapacity(selectedResource.resourceCd)}
          onSaveCapacity={(minutes) =>
            capacityMutation.mutate(
              { resourceCd: selectedResource.resourceCd, baseAvailableMinutes: minutes, ...scopeParams },
              { onSuccess: () => setEditingCapacityCd(null) }
            )
          }
          onCancelCapacity={() => setEditingCapacityCd(null)}
          onAction={(action) => {
            if (action.type === 'outsource' && action.vendorId) commitActions(applyOutsource(input, action.rowId, action.vendorId));
            else commitActions([...actions.filter((item) => item.rowId !== action.rowId), action]);
          }}
          onUndo={undoRow}
          vendors={data.outsourceSettings?.vendors ?? []}
          listVendors={(row) => (data.outsourceSettings?.vendors ?? []).map((vendor) => outsourceOption(input, row, vendor)).sort((a, b) => a.vendor.priority - b.vendor.priority || a.vendor.id.localeCompare(b.vendor.id))}
          resolveName={(resourceCd) => resolveLoadBalancingResourceDisplayName(resourceCd, resourceNameMap)}
          listDestinations={(row) => transferOptions(input, row, effectiveSelected.bucket)}
        />
      ) : (
        <section className="rounded-[10px] border border-white/15 bg-slate-900/70" />
      )}
      </div>
      <LoadBalancingOutsourcePanel input={input} noTaker={noTaker} onUndo={undoRow} />
    </div>
  );
}

function pickWorstCell(rows: HeatmapResourceRow[], months: string[], matrix: LoadMatrix): HeatmapSelection | null {
  let best: { selection: HeatmapSelection; over: number } | null = null;
  for (const { resource } of rows) {
    for (const month of months) {
      const capacity = readCapacity(resource, month);
      if (capacity == null) continue;
      const over = readLoad(matrix, resource.resourceCd, month) - capacity;
      if (!best || over > best.over) best = { selection: { resourceCd: resource.resourceCd, bucket: month }, over };
    }
  }
  if (best) return best.selection;
  const first = rows[0];
  return first ? { resourceCd: first.resource.resourceCd, bucket: months[0]! } : null;
}

function HeatmapLegend() {
  const swatch = 'mr-1 inline-block h-3.5 w-3.5 rounded-sm align-[-2px]';
  return (
    <div className="flex items-center gap-4 border-t border-white/10 px-3 py-2 text-[13px] text-white/60">
      <span>
        <i className={`${swatch} bg-[#16263d]`} />
        〜85%
      </span>
      <span>
        <i className={`${swatch} bg-amber-800`} />
        85〜100%
      </span>
      <span>
        <i className={`${swatch} bg-rose-800`} />
        100%超
      </span>
      <span>
        <i className={`${swatch} bg-[repeating-linear-gradient(135deg,#1b2638_0_3px,#2c3d5a_3px_6px)]`} />
        能力未設定
      </span>
      <span>
        <i className={`${swatch} bg-[#2a1320]`} />
        遅れ
      </span>
      <span className="ml-auto">移動 ←↑↓→</span>
    </div>
  );
}

/** ヘッダーの期間・機種・KPI */
export function LoadBalancingHeaderControls(props: {
  fromMonth: string;
  toMonth: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  machines: string[];
  machine: string;
  onMachineChange: (value: string) => void;
  overResourceCount: number;
  overMinutes: number;
  lateMinutes: number;
  unsetCount: number;
  highlightUnset: boolean;
  onToggleUnset: () => void;
  unallocatedCount: number;
  onShowUnallocated: () => void;
  loading: boolean;
}) {
  const kpi = 'inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-slate-800 px-2 font-bold';
  return (
    <>
      <div className="inline-flex items-center gap-0.5 rounded-lg bg-slate-800 p-0.5" aria-label="期間">
        <button
          type="button"
          className="h-9 w-7 rounded-md font-bold hover:bg-slate-700 disabled:opacity-30"
          aria-label="前の月へ"
          disabled={!props.canPrev}
          onClick={props.onPrev}
        >
          ◀
        </button>
        <span className="whitespace-nowrap px-1 text-sm font-bold tabular-nums">
          {formatYearMonthSlash(props.fromMonth)} 〜 {formatYearMonthSlash(props.toMonth)}
        </span>
        <button
          type="button"
          className="h-9 w-7 rounded-md font-bold hover:bg-slate-700 disabled:opacity-30"
          aria-label="次の月へ"
          disabled={!props.canNext}
          onClick={props.onNext}
        >
          ▶
        </button>
      </div>
      <select
        className="h-10 w-36 min-w-0 rounded-lg border border-white/15 bg-slate-800 px-2 text-sm font-semibold text-white"
        aria-label="機種"
        value={props.machine}
        onChange={(event) => props.onMachineChange(event.target.value)}
      >
        <option value="">機種：すべて</option>
        {props.machines.map((machine) => (
          <option key={machine} value={machine}>
            機種：{machine}
          </option>
        ))}
      </select>
      <span className={kpi}>
        <small className="text-[13px] text-white/60">超過資源</small>
        <b className="text-lg tabular-nums text-rose-400">{props.overResourceCount}</b>
      </span>
      <span className={kpi}>
        <small className="text-[13px] text-white/60">超過計</small>
        <b className="text-lg tabular-nums text-rose-400">{formatHours(props.overMinutes)}</b>
        <small className="text-[13px] text-white/60">H</small>
      </span>
      <span className={kpi}>
        <small className="text-[13px] text-white/60">遅れ残</small>
        <b className="text-lg tabular-nums">{formatHours(props.lateMinutes)}</b>
        <small className="text-[13px] text-white/60">H</small>
      </span>
      {props.unsetCount > 0 ? (
        <button
          type="button"
          className={`${kpi} bg-[repeating-linear-gradient(135deg,#1e293b_0_6px,#273449_6px_12px)] ${
            props.highlightUnset ? 'outline outline-2 outline-amber-200' : ''
          }`}
          aria-pressed={props.highlightUnset}
          onClick={props.onToggleUnset}
        >
          <small className="text-[13px] text-white/60">能力未設定</small>
          <b className="text-lg tabular-nums text-amber-200">{props.unsetCount}</b>
        </button>
      ) : null}
      {props.unallocatedCount > 0 ? (
        <button type="button" className={kpi} onClick={props.onShowUnallocated}>
          <small className="text-[13px] text-white/60">未配分</small>
          <b className="text-lg tabular-nums">{props.unallocatedCount}</b>
        </button>
      ) : null}
      {props.loading ? <span className="text-sm text-white/50">更新中…</span> : null}
    </>
  );
}

export const LOAD_BALANCING_MAX_OFFSET = MAX_OFFSET;
