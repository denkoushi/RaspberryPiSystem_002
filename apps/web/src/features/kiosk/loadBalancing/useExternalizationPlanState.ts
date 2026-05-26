import { useCallback, useMemo, useState } from 'react';

import {
  usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates,
  usePostKioskProductionScheduleLoadBalancingOutsourcingPlan,
  usePostKioskProductionScheduleLoadBalancingOutsourcingReplacements,
  usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate
} from '../../../api/hooks';

import type { ProductionScheduleLoadBalancingExternalizationCandidate } from '../../../api/client';

type ScopeParams = { month: string; targetDeviceScopeKey?: string };

type UseExternalizationPlanStateParams = {
  overviewParams: ScopeParams;
  overviewEnabled: boolean;
  selectedOverResourceCds: string[];
  onSimulateResult: (
    result: ReturnType<typeof usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate>['data'] | null
  ) => void;
};

export function parsePartCandidateId(candidateId: string): {
  fseiban: string;
  productNo: string;
  fhincd: string;
} {
  const [fseiban = '', productNo = '', fhincd = ''] = candidateId.split('\u001f');
  return { fseiban, productNo, fhincd };
}

function computeTargetRemainingOverMinutes(
  resources: Array<{ resourceCd: string; overMinutes: number }>,
  targetResourceCds: string[]
): number {
  if (targetResourceCds.length === 0) {
    return resources.reduce((sum, resource) => sum + resource.overMinutes, 0);
  }
  const targetSet = new Set(targetResourceCds);
  return resources.reduce((sum, resource) => {
    if (!targetSet.has(resource.resourceCd)) {
      return sum;
    }
    return sum + resource.overMinutes;
  }, 0);
}

export function useExternalizationPlanState(params: UseExternalizationPlanStateParams) {
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [planResolved, setPlanResolved] = useState<boolean | null>(null);
  const [planRemainingOverMinutes, setPlanRemainingOverMinutes] = useState<number | null>(null);
  const [externalizationCandidates, setExternalizationCandidates] = useState<
    ProductionScheduleLoadBalancingExternalizationCandidate[]
  >([]);
  const [replacementTargetId, setReplacementTargetId] = useState<string | null>(null);
  const [replacementOptions, setReplacementOptions] = useState<
    Array<{
      candidateId: string;
      fseiban: string;
      productNo: string;
      fhincd: string;
      fhinmei: string;
      resolved: boolean;
      remainingOverMinutes: number;
    }>
  >([]);

  const candidatesMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingCandidates();
  const planMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingPlan();
  const simulateMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingSimulate();
  const replacementsMutation = usePostKioskProductionScheduleLoadBalancingOutsourcingReplacements();

  const overResourcePayload =
    params.selectedOverResourceCds.length > 0 ? params.selectedOverResourceCds : undefined;

  const candidateById = useMemo(
    () => new Map(externalizationCandidates.map((candidate) => [candidate.candidateId, candidate])),
    [externalizationCandidates]
  );

  const resetPlanState = useCallback(() => {
    setSelectedCandidateIds([]);
    setPlanResolved(null);
    setPlanRemainingOverMinutes(null);
    setExternalizationCandidates([]);
    setReplacementTargetId(null);
    setReplacementOptions([]);
    planMutation.reset();
    replacementsMutation.reset();
  }, [planMutation, replacementsMutation]);

  const runSimulateForSelection = useCallback(
    async (candidateIds: string[]) => {
      if (candidateIds.length === 0) {
        params.onSimulateResult(null);
        setPlanRemainingOverMinutes(null);
        setPlanResolved(null);
        simulateMutation.reset();
        return;
      }
      const result = await simulateMutation.mutateAsync({
        ...params.overviewParams,
        overResourceCds: overResourcePayload,
        selectedCandidateIds: candidateIds
      });
      const remainingOverMinutes = computeTargetRemainingOverMinutes(
        result.afterResources,
        params.selectedOverResourceCds
      );
      params.onSimulateResult(result);
      setPlanRemainingOverMinutes(remainingOverMinutes);
      setPlanResolved(remainingOverMinutes <= 0);
    },
    [overResourcePayload, params, simulateMutation]
  );

  const ensureCandidatesLoaded = useCallback(async () => {
    const result = await candidatesMutation.mutateAsync({
      ...params.overviewParams,
      maxCandidates: 500,
      overResourceCds: overResourcePayload
    });
    setExternalizationCandidates(result.externalizationCandidates ?? []);
    return result.externalizationCandidates ?? [];
  }, [candidatesMutation, overResourcePayload, params.overviewParams]);

  const handleAutoPlan = useCallback(async () => {
    const plan = await planMutation.mutateAsync({
      ...params.overviewParams,
      overResourceCds: overResourcePayload,
      strategy: 'max_over_reduction'
    });
    await ensureCandidatesLoaded();
    setSelectedCandidateIds(plan.selectedCandidateIds);
    setPlanResolved(plan.resolved);
    setPlanRemainingOverMinutes(plan.remainingOverMinutes);
    setReplacementTargetId(null);
    setReplacementOptions([]);
    await runSimulateForSelection(plan.selectedCandidateIds);
  }, [ensureCandidatesLoaded, overResourcePayload, params.overviewParams, planMutation, runSimulateForSelection]);

  const handleRemoveCandidate = useCallback(
    async (candidateId: string) => {
      const next = selectedCandidateIds.filter((id) => id !== candidateId);
      setSelectedCandidateIds(next);
      setReplacementTargetId(null);
      setReplacementOptions([]);
      await runSimulateForSelection(next);
    },
    [runSimulateForSelection, selectedCandidateIds]
  );

  const handleLoadReplacements = useCallback(
    async (removeCandidateId: string) => {
      const result = await replacementsMutation.mutateAsync({
        ...params.overviewParams,
        overResourceCds: overResourcePayload,
        currentSelectedCandidateIds: selectedCandidateIds,
        removeCandidateId,
        maxOptions: 5
      });
      setReplacementTargetId(removeCandidateId);
      setReplacementOptions(result.replacementOptions);
    },
    [overResourcePayload, params.overviewParams, replacementsMutation, selectedCandidateIds]
  );

  const handleApplyReplacement = useCallback(
    async (addCandidateId: string) => {
      if (!replacementTargetId) return;
      const base = selectedCandidateIds.filter((id) => id !== replacementTargetId);
      const next = [...base, addCandidateId];
      setSelectedCandidateIds(next);
      setReplacementTargetId(null);
      setReplacementOptions([]);
      await runSimulateForSelection(next);
    },
    [replacementTargetId, runSimulateForSelection, selectedCandidateIds]
  );

  const handleClearPlan = useCallback(() => {
    resetPlanState();
    params.onSimulateResult(null);
    simulateMutation.reset();
  }, [params, resetPlanState, simulateMutation]);

  return {
    selectedCandidateIds,
    planResolved,
    planRemainingOverMinutes,
    externalizationCandidates,
    candidateById,
    replacementTargetId,
    replacementOptions,
    candidatesMutation,
    planMutation,
    simulateMutation,
    replacementsMutation,
    resetPlanState,
    handleAutoPlan,
    handleRemoveCandidate,
    handleLoadReplacements,
    handleApplyReplacement,
    handleClearPlan,
    overviewEnabled: params.overviewEnabled,
    selectedOverResourceCds: params.selectedOverResourceCds
  };
}
