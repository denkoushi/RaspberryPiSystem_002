import { useCallback, useMemo, useRef, useState } from 'react';

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
  const { overviewParams, overviewEnabled, selectedOverResourceCds, onSimulateResult } = params;
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
  const mutationRefs = useRef({
    loadCandidates: candidatesMutation.mutateAsync,
    plan: planMutation.mutateAsync,
    simulate: simulateMutation.mutateAsync,
    loadReplacements: replacementsMutation.mutateAsync,
    resetPlan: planMutation.reset,
    resetSimulate: simulateMutation.reset,
    resetReplacements: replacementsMutation.reset
  });
  mutationRefs.current = {
    loadCandidates: candidatesMutation.mutateAsync,
    plan: planMutation.mutateAsync,
    simulate: simulateMutation.mutateAsync,
    loadReplacements: replacementsMutation.mutateAsync,
    resetPlan: planMutation.reset,
    resetSimulate: simulateMutation.reset,
    resetReplacements: replacementsMutation.reset
  };

  const overResourcePayload = selectedOverResourceCds.length > 0 ? selectedOverResourceCds : undefined;

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
    mutationRefs.current.resetPlan();
    mutationRefs.current.resetReplacements();
  }, []);

  const runSimulateForSelection = useCallback(
    async (candidateIds: string[]) => {
      if (candidateIds.length === 0) {
        onSimulateResult(null);
        setPlanRemainingOverMinutes(null);
        setPlanResolved(null);
        mutationRefs.current.resetSimulate();
        return;
      }
      const result = await mutationRefs.current.simulate({
        ...overviewParams,
        overResourceCds: overResourcePayload,
        selectedCandidateIds: candidateIds
      });
      const remainingOverMinutes = computeTargetRemainingOverMinutes(
        result.afterResources,
        selectedOverResourceCds
      );
      onSimulateResult(result);
      setPlanRemainingOverMinutes(remainingOverMinutes);
      setPlanResolved(remainingOverMinutes <= 0);
    },
    [onSimulateResult, overResourcePayload, overviewParams, selectedOverResourceCds]
  );

  const ensureCandidatesLoaded = useCallback(async () => {
    const result = await mutationRefs.current.loadCandidates({
      ...overviewParams,
      maxCandidates: 500,
      overResourceCds: overResourcePayload
    });
    setExternalizationCandidates(result.externalizationCandidates ?? []);
    return result.externalizationCandidates ?? [];
  }, [overResourcePayload, overviewParams]);

  const handleAutoPlan = useCallback(async () => {
    const plan = await mutationRefs.current.plan({
      ...overviewParams,
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
  }, [ensureCandidatesLoaded, overResourcePayload, overviewParams, runSimulateForSelection]);

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
      const result = await mutationRefs.current.loadReplacements({
        ...overviewParams,
        overResourceCds: overResourcePayload,
        currentSelectedCandidateIds: selectedCandidateIds,
        removeCandidateId,
        maxOptions: 5
      });
      setReplacementTargetId(removeCandidateId);
      setReplacementOptions(result.replacementOptions);
    },
    [overResourcePayload, overviewParams, selectedCandidateIds]
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
    onSimulateResult(null);
    mutationRefs.current.resetSimulate();
  }, [onSimulateResult, resetPlanState]);

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
    overviewEnabled,
    selectedOverResourceCds
  };
}
