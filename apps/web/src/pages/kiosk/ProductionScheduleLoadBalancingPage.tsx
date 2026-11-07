import { useMemo, useState } from 'react';

import { usePutKioskProductionScheduleLoadBalancingOutsourceSettings } from '../../api/hooks';
import { buildWorkspaceMachineNames } from '../../features/kiosk/loadBalancing/loadBalancingFormat';
import { LoadBalancingOutsourceSettings } from '../../features/kiosk/loadBalancing/LoadBalancingOutsourceSettings';
import { LoadBalancingPageHeader } from '../../features/kiosk/loadBalancing/LoadBalancingPageHeader';
import { autoSelect, buildLoadMatrix, DEFAULT_OUTSOURCE_SETTINGS, summarizeScenarioActions } from '../../features/kiosk/loadBalancing/loadBalancingScenario';
import {
  LOAD_BALANCING_MAX_OFFSET,
  LoadBalancingHeaderControls,
  LoadBalancingWorkspaceView,
  computeWorkspaceSummary,
  useLoadBalancingWorkspaceState
} from '../../features/kiosk/loadBalancing/LoadBalancingWorkspace';
import { usePersistedLoadBalancingScawMode } from '../../features/kiosk/loadBalancing/usePersistedLoadBalancingScawMode';
import { useProductionScheduleMacDeviceScope } from '../../features/kiosk/loadBalancing/useProductionScheduleMacDeviceScope';

export function ProductionScheduleLoadBalancingPage() {
  const macScope = useProductionScheduleMacDeviceScope();
  const { scawEnabled, toggleScawMode } = usePersistedLoadBalancingScawMode(
    macScope.macManualOrderV2 ? macScope.macTargetSite : '',
    macScope.macManualOrderV2 ? macScope.macTargetDevice : ''
  );
  const dueSource: 'excel' | 'scaw' = scawEnabled ? 'scaw' : 'excel';
  const state = useLoadBalancingWorkspaceState({
    dueSource,
    scopeParams: macScope.scopeParams,
    scopeEnabled: macScope.scopeEnabled
  });
  const [machine, setMachine] = useState('');
  const [highlightUnset, setHighlightUnset] = useState(false);
  const [panel, setPanel] = useState<'cell' | 'unallocated'>('cell');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsMutation = usePutKioskProductionScheduleLoadBalancingOutsourceSettings();
  const data = state.query.data;
  const input = data ? { rows: data.rows, months: data.months, resources: data.resources, rules: data.transferRules, settings: data.outsourceSettings ?? DEFAULT_OUTSOURCE_SETTINGS, actions: state.actions, machine, today: data.today } : null;
  const outsourceMinutes = data ? summarizeScenarioActions(data.rows, state.actions).find((item) => item.type === 'outsource')!.minutes : 0;
  const baseMatrix = useMemo(() => (data ? buildLoadMatrix(data.rows, [], data.months) : undefined), [data]);
  const summary = useMemo(
    () => (data ? computeWorkspaceSummary(data, state.actions, baseMatrix) : null),
    [data, state.actions, baseMatrix]
  );
  const { machines, formattedNames } = useMemo(() => buildWorkspaceMachineNames(data?.rows ?? []), [data?.rows]);

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
      <LoadBalancingPageHeader macProxy={macProxy} scawEnabled={scawEnabled} onToggleScawMode={toggleScawMode}>
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
        <span className="inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-slate-800 px-2 font-bold"><small className="text-[13px] text-white/60">外注</small><b className="text-lg tabular-nums">{Math.round(outsourceMinutes / 6) / 10}</b><small className="text-white/60">H</small></span>
        <button type="button" className="ml-auto h-10 shrink-0 rounded-lg bg-emerald-600 px-3 text-sm font-bold disabled:opacity-30" disabled={!input || !summary || summary.after.overMinutes <= 0.5} onClick={() => input && state.commitResult(autoSelect(input))}>自動選定</button>
        <button type="button" className="h-10 shrink-0 rounded-lg bg-slate-800 px-2 text-sm font-bold disabled:opacity-30" disabled={!state.canUndo} onClick={state.undo}>1つ戻す</button>
        <button type="button" className="h-10 shrink-0 rounded-lg bg-slate-800 px-2 text-sm font-bold disabled:opacity-30" disabled={!state.actions.length && !state.result.noTaker.length} onClick={() => state.commitResult({ actions: [], noTaker: [] })}>クリア</button>
        <button type="button" className="h-10 w-10 shrink-0 rounded-lg bg-slate-800 text-xl" aria-label="業者の設定" disabled={!data || state.query.isPlaceholderData} onClick={() => { settingsMutation.reset(); setSettingsOpen(true); }}>⚙</button>
      </LoadBalancingPageHeader>

      {settingsOpen && data && !state.query.isPlaceholderData ? <LoadBalancingOutsourceSettings key={`${data.siteKey}|${macScope.scopeParams.targetDeviceScopeKey ?? ''}`} settings={data.outsourceSettings ?? DEFAULT_OUTSOURCE_SETTINGS} resources={data.resources.map((resource) => resource.resourceCd)} saving={settingsMutation.isPending} error={settingsMutation.error ? '保存できませんでした' : null} onClose={() => setSettingsOpen(false)} onSave={(settings) => settingsMutation.mutate({ ...settings, ...macScope.scopeParams }, { onSuccess: () => { setSettingsOpen(false); state.reset(); } })} /> : null}
      {state.query.error ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-rose-100" role="alert">
          読み込めませんでした
        </div>
      ) : null}

      {!macScope.scopeEnabled ? (
        <p className="p-4 text-white/60">右上の V から対象端末を選んでください</p>
      ) : data && summary ? (
        <LoadBalancingWorkspaceView
          data={data}
          workspaceSummary={summary}
          formattedMachineNames={formattedNames}
          thisMonth={state.thisMonth}
          resourceNameMap={state.resourceNameMap}
          actions={state.actions}
          commitResult={state.commitResult}
          noTaker={state.result.noTaker}
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
