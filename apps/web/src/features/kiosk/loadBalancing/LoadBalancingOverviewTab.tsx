import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionScheduleLoadBalancingOverview,
  usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates,
  usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate,
  usePostKioskProductionScheduleLoadBalancingSuggestions
} from '../../../api/hooks';

import { ExternalizationPlanPanel } from './ExternalizationPlanPanel';
import {
  listOverResourceCds,
  toggleSelectedResourceCd,
  toggleSelectedRowId
} from './loadBalancingOutsourcingSelection';
import { LoadBalancingOverviewLegacyOutsourcingSection } from './LoadBalancingOverviewLegacyOutsourcingSection';
import { LoadBalancingOverviewResourceChart } from './LoadBalancingOverviewResourceChart';
import { LoadBalancingOverviewResourceChips } from './LoadBalancingOverviewResourceChips';
import { LoadBalancingOverviewResultsTable } from './LoadBalancingOverviewResultsTable';
import {
  buildLoadBalancingOverviewSessionContext,
  buildLoadBalancingScopeKey,
  shouldResetLoadBalancingOverviewSession
} from './loadBalancingOverviewSession';
import { LoadBalancingOverviewSuggestionsSection } from './LoadBalancingOverviewSuggestionsSection';
import { LoadBalancingStepHeading } from './LoadBalancingStepHeading';
import { useExternalizationPlanState } from './useExternalizationPlanState';

function defaultYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

type ScopeParams = { targetDeviceScopeKey?: string };

type Props = {
  scopeParams: ScopeParams;
  scopeEnabled: boolean;
};

export function LoadBalancingOverviewTab({ scopeParams, scopeEnabled }: Props) {
  const [month, setMonth] = useState(defaultYearMonth);
  const [selectedOverResourceCds, setSelectedOverResourceCds] = useState<string[]>([]);
  const [selectedCandidateRowIds, setSelectedCandidateRowIds] = useState<string[]>([]);
  const [candidateResult, setCandidateResult] = useState<
    ReturnType<typeof usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates>['data'] | null
  >(null);
  const [simulateResult, setSimulateResult] = useState<
    ReturnType<typeof usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate>['data'] | null
  >(null);

  const overviewParams = useMemo(() => ({ month: month.trim(), ...scopeParams }), [month, scopeParams]);
  const overviewEnabled = /^\d{4}-\d{2}$/.test(month.trim()) && scopeEnabled;

  const overviewQuery = useKioskProductionScheduleLoadBalancingOverview(overviewParams, {
    enabled: overviewEnabled
  });
  const suggestionsMutation = usePostKioskProductionScheduleLoadBalancingSuggestions();
  const candidatesMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates();
  const simulateMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate();

  const overResourceOptions = useMemo(
    () => listOverResourceCds(overviewQuery.data?.resources ?? []),
    [overviewQuery.data?.resources]
  );

  const overResourceKey = useMemo(() => overResourceOptions.join('\t'), [overResourceOptions]);
  const scopeKey = useMemo(() => buildLoadBalancingScopeKey(scopeParams), [scopeParams]);
  const sessionContext = useMemo(
    () => buildLoadBalancingOverviewSessionContext(month, scopeKey, overResourceKey),
    [month, scopeKey, overResourceKey]
  );

  const planState = useExternalizationPlanState({
    overviewParams,
    overviewEnabled,
    selectedOverResourceCds,
    onSimulateResult: setSimulateResult
  });
  const resetPlanState = planState.resetPlanState;

  const resetOutsourcingState = useCallback(() => {
    setSelectedCandidateRowIds([]);
    setCandidateResult(null);
    setSimulateResult(null);
    suggestionsMutation.reset();
    candidatesMutation.reset();
    simulateMutation.reset();
    resetPlanState();
  }, [candidatesMutation, resetPlanState, simulateMutation, suggestionsMutation]);

  const prevSessionContextRef = useRef<typeof sessionContext | null>(null);

  useEffect(() => {
    setSelectedOverResourceCds(overResourceOptions);
    // overResourceOptions は overResourceKey 変化時の同一レンダーで整合する
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 参照変化だけでは再選択しない
  }, [overResourceKey]);

  useEffect(() => {
    const previous = prevSessionContextRef.current;
    prevSessionContextRef.current = sessionContext;

    if (previous == null) {
      suggestionsMutation.reset();
      return;
    }

    if (shouldResetLoadBalancingOverviewSession(previous, sessionContext)) {
      resetOutsourcingState();
    }
  }, [resetOutsourcingState, sessionContext, suggestionsMutation]);

  const displayResources = useMemo(
    () => simulateResult?.afterResources ?? overviewQuery.data?.resources ?? [],
    [simulateResult?.afterResources, overviewQuery.data?.resources]
  );

  const chartSlice = useMemo(() => {
    const mapped = displayResources.map((resource) => ({
      cd: resource.resourceCd,
      req: Math.round(resource.requiredMinutes),
      cap: resource.availableMinutes == null ? 0 : Math.round(resource.availableMinutes),
      over: Math.round(resource.overMinutes)
    }));
    return mapped.sort((a, b) => b.req - a.req).slice(0, 48);
  }, [displayResources]);

  const chipItems = useMemo(
    () =>
      overResourceOptions.map((resourceCd) => ({
        resourceCd,
        selected: selectedOverResourceCds.includes(resourceCd),
        overMinutes:
          overviewQuery.data?.resources.find((resource) => resource.resourceCd === resourceCd)?.overMinutes ?? 0
      })),
    [overResourceOptions, overviewQuery.data?.resources, selectedOverResourceCds]
  );

  const handleSuggest = async () => {
    if (selectedOverResourceCds.length === 0) return;
    await suggestionsMutation.mutateAsync({
      ...overviewParams,
      maxSuggestions: 40,
      overResourceCds: selectedOverResourceCds
    });
  };

  const handleLoadCandidates = async () => {
    if (selectedOverResourceCds.length === 0) return;
    const result = await candidatesMutation.mutateAsync({
      ...overviewParams,
      maxCandidates: 100,
      overResourceCds: selectedOverResourceCds
    });
    setCandidateResult(result);
    setSelectedCandidateRowIds([]);
    setSimulateResult(null);
    simulateMutation.reset();
  };

  const handleSimulate = async () => {
    if (selectedOverResourceCds.length === 0) return;
    const result = await simulateMutation.mutateAsync({
      ...overviewParams,
      overResourceCds: selectedOverResourceCds,
      selectedRowIds: selectedCandidateRowIds
    });
    setSimulateResult(result);
  };

  const beforeResourceMap = useMemo(() => {
    const map = new Map<string, { requiredMinutes: number; overMinutes: number }>();
    for (const resource of simulateResult?.beforeResources ?? overviewQuery.data?.resources ?? []) {
      map.set(resource.resourceCd, {
        requiredMinutes: resource.requiredMinutes,
        overMinutes: resource.overMinutes
      });
    }
    return map;
  }, [overviewQuery.data?.resources, simulateResult?.beforeResources]);

  const hasSimulation = simulateResult != null;
  const hasSelectedOverResources = selectedOverResourceCds.length > 0;

  return (
    <>
      <section className="rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <div className="grid gap-3 lg:grid-cols-[190px_minmax(360px,1fr)]">
          <div>
            <LoadBalancingStepHeading step={1} className="mb-2">
              対象月
            </LoadBalancingStepHeading>
            <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
              <span className="sr-only">対象月</span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
              />
            </label>
          </div>
          <LoadBalancingOverviewResourceChips
            chips={chipItems}
            suggestionsPending={suggestionsMutation.isPending}
            overviewEnabled={overviewEnabled}
            hasSelectedOverResources={hasSelectedOverResources}
            onSelectAll={() => {
              setSelectedOverResourceCds(overResourceOptions);
              resetOutsourcingState();
            }}
            onClearSelection={() => {
              setSelectedOverResourceCds([]);
              resetOutsourcingState();
            }}
            onSuggest={() => void handleSuggest()}
            onToggle={(resourceCd) => {
              setSelectedOverResourceCds((current) => toggleSelectedResourceCd(current, resourceCd));
              resetOutsourcingState();
            }}
          />
        </div>
      </section>

      {overviewQuery.error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-100">
          読み込みエラー:{' '}
          {overviewQuery.error instanceof Error ? overviewQuery.error.message : String(overviewQuery.error)}
        </div>
      ) : null}

      {overviewQuery.isFetching ? <p className="text-xs text-white/70">集計を読み込み中…</p> : null}

      {overviewQuery.data ? (
        <p className="text-[11px] text-white/60">
          siteKey: <span className="font-mono text-white/90">{overviewQuery.data.siteKey}</span> / yearMonth:{' '}
          <span className="font-mono text-white/90">{overviewQuery.data.yearMonth}</span>（計画完了月）
          {hasSimulation ? <span className="ml-2 text-amber-200">（外注シミュ結果）</span> : null}
        </p>
      ) : null}

      <div className="grid items-stretch gap-2 xl:grid-cols-[minmax(320px,0.88fr)_minmax(390px,1.12fr)]">
        <section className="min-h-[260px] rounded-lg border border-white/15 bg-slate-950/50 p-2">
          <p className="mb-2 text-xs font-semibold text-white">資源CD別（上位48・必要分降順）</p>
          <LoadBalancingOverviewResourceChart rows={chartSlice} />
        </section>

        <ExternalizationPlanPanel
          embedded
          enabled={overviewEnabled}
          hasSelectedOverResources={hasSelectedOverResources}
          selectedCandidateIds={planState.selectedCandidateIds}
          planResolved={planState.planResolved}
          planRemainingOverMinutes={planState.planRemainingOverMinutes}
          candidateById={planState.candidateById}
          replacementTargetId={planState.replacementTargetId}
          replacementOptions={planState.replacementOptions}
          isPlanning={planState.planMutation.isPending}
          isSimulating={planState.simulateMutation.isPending}
          isReplacementsLoading={planState.replacementsMutation.isPending}
          actionError={planState.actionError}
          onAutoPlan={() => void planState.handleAutoPlan()}
          onRemoveCandidate={(id) => void planState.handleRemoveCandidate(id)}
          onLoadReplacements={(id) => void planState.handleLoadReplacements(id)}
          onApplyReplacement={(id) => void planState.handleApplyReplacement(id)}
          onClearPlan={planState.handleClearPlan}
        />
      </div>

      <LoadBalancingOverviewResultsTable
        resources={displayResources}
        beforeByResourceCd={beforeResourceMap}
        showSimulationColumns={hasSimulation}
        onReset={resetOutsourcingState}
      />

      <LoadBalancingOverviewLegacyOutsourcingSection
        overviewEnabled={overviewEnabled}
        selectedOverResourceCount={selectedOverResourceCds.length}
        selectedCandidateRowIds={selectedCandidateRowIds}
        candidateResult={candidateResult ?? null}
        simulateResult={simulateResult ?? null}
        candidatesPending={candidatesMutation.isPending}
        simulatePending={simulateMutation.isPending}
        candidatesError={candidatesMutation.error}
        simulateError={simulateMutation.error}
        onLoadCandidates={() => void handleLoadCandidates()}
        onSimulate={() => void handleSimulate()}
        onClearSimulate={() => {
          setSimulateResult(null);
          simulateMutation.reset();
        }}
        onToggleRow={(rowId) =>
          setSelectedCandidateRowIds((current) => toggleSelectedRowId(current, rowId))
        }
      />

      <LoadBalancingOverviewSuggestionsSection
        suggestions={suggestionsMutation.data?.suggestions ?? []}
        error={suggestionsMutation.error}
      />
    </>
  );
}
