import { isInspectionDrawingDepthLabel, resolveInspectionDrawingGeneralToleranceForNominal } from '@raspi-system/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { listPartMeasurementDrawingOcrCandidates } from '../../../api/domains/part-measurement';
import {
  getInspectionDrawingPlacementProposals,
  postInspectionDrawingPlacementDecisions
} from '../../../api/domains/part-measurement-placement';

import { filterExistingPlacementRows, numberPlacementProposals, proposalToDrawingPoint } from './proposalToDrawingPoint';

import type { PartMeasurementDrawingOcrCandidateDto, PartMeasurementProcessGroup } from '../types';
import type { InspectionDrawingPoint } from './types';
import type { DrawingPlacementProposal, DrawingPlacementUnplaced } from '../../../api/domains/part-measurement-placement';

export type DrawingProposalTab = 'proposals' | 'unplaced' | 'confirmed';

type ProposalOverride = Pick<DrawingPlacementProposal, 'anchorXRatio' | 'anchorYRatio'> &
  Partial<Pick<DrawingPlacementProposal, 'nominalValue' | 'lowerLimit' | 'upperLimit' | 'dimensionText'>> & { moved: true };

// 寸法図の明記公差 → 深さは下限 0 → 普通公差 → 読めなければ上下限なし（サイドバーの候補適用と同じ順）。
function ocrCandidateLimits(candidate: PartMeasurementDrawingOcrCandidateDto, nominalValue: number, label: string) {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  const offset = (raw: string | null | undefined) =>
    raw != null && raw.trim() && Number.isFinite(Number(raw)) ? round(nominalValue + Number(raw)) : null;
  const lower = offset(candidate.suggestedLowerTolerance);
  const upper = offset(candidate.suggestedUpperTolerance);
  if (candidate.source === 'dimensionMap' && (lower !== null || upper !== null)) {
    return { lowerLimit: lower, upperLimit: upper };
  }
  if (isInspectionDrawingDepthLabel(label)) return { lowerLimit: nominalValue, upperLimit: null };
  const general = resolveInspectionDrawingGeneralToleranceForNominal(nominalValue);
  return general === null
    ? { lowerLimit: null, upperLimit: null }
    : { lowerLimit: offset(`-${general}`), upperLimit: offset(general) };
}

function emptySession(visualTemplateId: string | null, processGroup: PartMeasurementProcessGroup) {
  return {
    visualTemplateId, processGroup,
    dismissed: [] as string[],
    overrides: {} as Record<string, ProposalOverride>,
    pending: {} as Record<string, string>,
    selectedId: null as string | null,
    armedId: null as string | null,
    tab: 'proposals' as DrawingProposalTab
  };
}

export function useInspectionDrawingPlacementProposals({
  visualTemplateId, processGroup, enabled, clientKey, points, onPointsChange, onSelectPoint, onPlaceMode
}: {
  visualTemplateId: string | null;
  processGroup: PartMeasurementProcessGroup;
  enabled: boolean;
  clientKey?: string;
  points: InspectionDrawingPoint[];
  onPointsChange: (points: InspectionDrawingPoint[]) => void;
  onSelectPoint: (id: string | null) => void;
  onPlaceMode: () => void;
}) {
  const [session, setSession] = useState(() => emptySession(visualTemplateId, processGroup));
  useEffect(() => setSession(emptySession(visualTemplateId, processGroup)), [visualTemplateId, processGroup]);
  useEffect(() => {
    if (!enabled) setSession((previous) => ({ ...previous, armedId: null }));
  }, [enabled]);
  const current = session.visualTemplateId === visualTemplateId && session.processGroup === processGroup ? session : emptySession(visualTemplateId, processGroup);
  const query = useQuery({
    queryKey: ['inspection-drawing-placement-proposals', visualTemplateId, processGroup, clientKey],
    queryFn: () => getInspectionDrawingPlacementProposals(visualTemplateId!, processGroup, clientKey),
    enabled: enabled && Boolean(visualTemplateId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });
  const data = enabled && query.data?.status === 'ready' ? query.data : undefined;
  const visible = <T extends { id: string }>(rows: T[]) =>
    rows.filter((row) => !current.dismissed.includes(row.id));
  const proposals = numberPlacementProposals(
    filterExistingPlacementRows(visible(data?.proposals ?? []).map((row) => ({ ...row, ...current.overrides[row.id] })), points), points
  );
  const unplaced = filterExistingPlacementRows(visible(data?.unplaced ?? []), points);

  const setTab = (tab: DrawingProposalTab) =>
    setSession({ ...current, tab, armedId: null, selectedId: tab === 'proposals' ? current.selectedId : null });
  const selectProposal = (id: string) => {
    onSelectPoint(null);
    setSession({ ...current, selectedId: id, tab: 'proposals', armedId: null });
  };
  const moveProposal = (id: string, x: number, y: number) => {
    const row = proposals.find((proposal) => proposal.id === id);
    if (!enabled || !visualTemplateId || !row) return;
    const override: ProposalOverride = {
      ...current.overrides[id], anchorXRatio: Math.max(0, Math.min(1, x)),
      anchorYRatio: Math.max(0, Math.min(1, y)), moved: true
    };
    onSelectPoint(null);
    setSession((previous) => ({
      ...previous, overrides: { ...previous.overrides, [id]: override },
      selectedId: id, tab: 'proposals', armedId: null
    }));
    void listPartMeasurementDrawingOcrCandidates(visualTemplateId, {
      xRatio: override.anchorXRatio!, yRatio: override.anchorYRatio!, markerNo: row.markerNo,
      limit: 5, measurementLabel: row.measurementLabel.trim() || null, depthMode: row.depthMode,
      calloutTipXRatio: null, calloutTipYRatio: null
    }, clientKey).then((result) => {
      const candidate = result.candidates[0];
      if (!candidate || !candidate.valueText.trim()) return;
      const nominalValue = Number(candidate.valueText);
      if (!Number.isFinite(nominalValue)) return;
      setSession((previous) => {
        if (previous.overrides[id] !== override || previous.dismissed.includes(id)) return previous;
        const updated = { ...override, nominalValue,
          dimensionText: candidate.dimensionText ?? candidate.rawText };
        return { ...previous, overrides: { ...previous.overrides, [id]: {
          ...updated, ...ocrCandidateLimits(candidate, nominalValue, row.measurementLabel)
        } } };
      });
    }).catch((error: unknown) => console.warn('AI案のOCR候補取得に失敗しました。', error));
  };
  const approveRows = (rows: DrawingPlacementProposal[]) => {
    const next = [...points];
    const pending = { ...current.pending };
    const dismissed = [...current.dismissed];
    for (const requested of rows) {
      const row = proposals.find((proposal) => proposal.id === requested.id);
      if (!row) continue;
      if (row.markerXRatio === null || row.markerYRatio === null) continue;
      const point = proposalToDrawingPoint(row, next, row.markerXRatio, row.markerYRatio);
      next.push(point);
      pending[row.id] = point.id;
      dismissed.push(row.id);
    }
    if (next.length === points.length) return;
    onPointsChange(next);
    onSelectPoint(next[next.length - 1].id);
    setSession({ ...current, pending, dismissed, selectedId: null, armedId: null });
  };
  const reject = (row: DrawingPlacementProposal) => {
    if (!enabled || !visualTemplateId) return;
    setSession({ ...current, dismissed: [...current.dismissed, row.id], selectedId: null });
    void postInspectionDrawingPlacementDecisions(visualTemplateId, { rejectedIds: [row.id] }, clientKey)
      .catch((error: unknown) => console.warn('AI案の却下記録に失敗しました。', error));
  };
  const arm = (row: DrawingPlacementUnplaced) => {
    onPlaceMode();
    setSession({ ...current, armedId: current.armedId === row.id ? null : row.id, tab: 'unplaced' });
  };
  const placeArmed = (x: number, y: number): boolean => {
    const row = unplaced.find((candidate) => candidate.id === current.armedId);
    if (!row) return false;
    const point = proposalToDrawingPoint(row, points, x, y);
    onPointsChange([...points, point]);
    onSelectPoint(point.id);
    setSession({
      ...current, dismissed: [...current.dismissed, row.id], armedId: null, tab: 'confirmed'
    });
    return true;
  };
  // Only call after the template save succeeds, using the exact points sent to that save.
  const flushApprovals = (savedPoints: InspectionDrawingPoint[]) => {
    const savedIds = Object.entries(current.pending)
      .filter(([, pointId]) => savedPoints.some((point) => point.id === pointId))
      .map(([id]) => id);
    const approvedIds = savedIds.filter((id) => !current.overrides[id]?.moved);
    const rejectedIds = savedIds.filter((id) => current.overrides[id]?.moved);
    setSession((previous) => previous.visualTemplateId === visualTemplateId && previous.processGroup === processGroup
      ? { ...previous, pending: {} }
      : previous);
    if (!visualTemplateId || !savedIds.length) return;
    void postInspectionDrawingPlacementDecisions(visualTemplateId, {
      ...(approvedIds.length ? { approvedIds } : {}),
      ...(rejectedIds.length ? { rejectedIds } : {})
    }, clientKey)
      .catch((error: unknown) => console.warn('AI案の承認記録に失敗しました。', error));
  };

  return {
    proposals, unplaced, sourceDrawingName: data?.sourceDrawingName ?? null,
    selectedProposalId: current.selectedId, armedId: current.armedId, tab: current.tab,
    setTab, selectProposal, moveProposal, approve: (row: DrawingPlacementProposal) => approveRows([row]),
    approveAll: () => approveRows(proposals), reject, arm, placeArmed, flushApprovals
  };
}

export type InspectionDrawingPlacementProposals = ReturnType<typeof useInspectionDrawingPlacementProposals>;
