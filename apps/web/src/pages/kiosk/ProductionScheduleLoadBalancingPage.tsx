import { useMemo, useState } from 'react';

import { formatLoadBalancingMachineName } from '../../features/kiosk/loadBalancing/loadBalancingFormat';
import { LoadBalancingPageHeader } from '../../features/kiosk/loadBalancing/LoadBalancingPageHeader';
import {
  LOAD_BALANCING_MAX_OFFSET,
  LoadBalancingHeaderControls,
  LoadBalancingWorkspaceView,
  computeWorkspaceSummary,
  useLoadBalancingWorkspaceState
} from '../../features/kiosk/loadBalancing/LoadBalancingWorkspace';
import { useProductionScheduleMacDeviceScope } from '../../features/kiosk/loadBalancing/useProductionScheduleMacDeviceScope';

export function ProductionScheduleLoadBalancingPage() {
  const macScope = useProductionScheduleMacDeviceScope();
  const state = useLoadBalancingWorkspaceState({
    scopeParams: macScope.scopeParams,
    scopeEnabled: macScope.scopeEnabled
  });
  const [machine, setMachine] = useState('');
  const [highlightUnset, setHighlightUnset] = useState(false);
  const [panel, setPanel] = useState<'cell' | 'unallocated'>('cell');

  const data = state.query.data;
  const summary = useMemo(() => (data ? computeWorkspaceSummary(data, state.actions) : null), [data, state.actions]);
  const machines = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of data?.rows ?? []) {
      const name = formatLoadBalancingMachineName(row.machineName);
      totals.set(name, (totals.get(name) ?? 0) + row.totalMinutes);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [data?.rows]);

  const macContextNote = useMemo(() => {
    if (!macScope.macManualOrderV2) return undefined;
    const device = macScope.macTargetDevice.trim();
    return `siteKey: ${macScope.macTargetSite} / scope: ${device || '（未選択）'}`;
  }, [macScope.macManualOrderV2, macScope.macTargetDevice, macScope.macTargetSite]);

  const macProxy = macScope.macManualOrderV2
    ? {
        macManualOrderV2: macScope.macManualOrderV2,
        macTargetSite: macScope.macTargetSite,
        setMacTargetSite: macScope.setMacTargetSite,
        macTargetDevice: macScope.macTargetDevice,
        setMacTargetDevice: macScope.setMacTargetDevice,
        deviceScopeKeys: macScope.macSiteDevicesQuery.data?.deviceScopeKeys ?? [],
        contextNote: macContextNote
      }
    : undefined;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 p-2 text-[15px] leading-snug text-white">
      <LoadBalancingPageHeader macProxy={macProxy}>
        <LoadBalancingHeaderControls
          fromMonth={state.fromMonth}
          toMonth={state.toMonth}
          canPrev={state.offset > 0}
          canNext={state.offset < LOAD_BALANCING_MAX_OFFSET}
          onPrev={() => state.setOffset(state.offset - 1)}
          onNext={() => state.setOffset(state.offset + 1)}
          machines={machines}
          machine={machine}
          onMachineChange={setMachine}
          overResourceCount={summary?.after.overResourceCount ?? 0}
          overMinutes={summary?.after.overMinutes ?? 0}
          lateMinutes={summary?.lateMinutes ?? 0}
          unsetCount={summary?.unsetCount ?? 0}
          highlightUnset={highlightUnset}
          onToggleUnset={() => setHighlightUnset((current) => !current)}
          unallocatedCount={data?.unallocatedRows.length ?? 0}
          onShowUnallocated={() => setPanel('unallocated')}
          loading={state.query.isFetching && Boolean(data)}
        />
      </LoadBalancingPageHeader>

      {state.query.error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-rose-100" role="alert">
          読み込めませんでした
        </div>
      ) : null}

      {!macScope.scopeEnabled ? (
        <p className="p-4 text-white/60">右上の V から対象端末を選んでください</p>
      ) : data ? (
        <LoadBalancingWorkspaceView
          data={data}
          thisMonth={state.thisMonth}
          resourceNameMap={state.resourceNameMap}
          actions={state.actions}
          setActions={state.setActions}
          machine={machine}
          highlightUnset={highlightUnset}
          panel={panel}
          onClosePanel={() => setPanel('cell')}
          scopeParams={macScope.scopeParams}
        />
      ) : state.query.isFetching ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-2" aria-busy>
          <div className="animate-pulse rounded-[10px] bg-white/5" />
          <div className="animate-pulse rounded-[10px] bg-white/5" />
        </div>
      ) : null}
    </div>
  );
}
