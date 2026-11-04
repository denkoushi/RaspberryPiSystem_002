import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  getInspectionDrawingPlacementProposals,
  postInspectionDrawingPlacementDecisions
} from '../../../api/domains/part-measurement-placement';

import { filterExistingPlacementRows, numberPlacementProposals, proposalToDrawingPoint } from './proposalToDrawingPoint';

import type { PartMeasurementProcessGroup } from '../types';
import type { InspectionDrawingPoint } from './types';
import type { DrawingPlacementProposal, DrawingPlacementUnplaced } from '../../../api/domains/part-measurement-placement';

export type DrawingProposalTab = 'proposals' | 'unplaced' | 'confirmed';

function emptySession(visualTemplateId: string | null, processGroup: PartMeasurementProcessGroup) {
  return {
    visualTemplateId, processGroup,
    dismissed: [] as string[],
    pending: {} as Record<string, string>,
    positions: {} as Record<string, { xRatio: number; yRatio: number }>,
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
    filterExistingPlacementRows(visible(data?.proposals ?? []).map((row) => {
      const position = current.positions[row.id];
      return position ? { ...row, markerXRatio: position.xRatio, markerYRatio: position.yRatio } : row;
    }), points), points
  );
  const unplaced = filterExistingPlacementRows(visible(data?.unplaced ?? []), points);

  const setTab = (tab: DrawingProposalTab) =>
    setSession({ ...current, tab, armedId: null, selectedId: tab === 'proposals' ? current.selectedId : null });
  const selectProposal = (id: string) => {
    onSelectPoint(null);
    setSession({ ...current, selectedId: id, tab: 'proposals', armedId: null });
  };
  const moveProposal = (id: string, position: { xRatio: number; yRatio: number }) => {
    if (!enabled || !proposals.some((proposal) => proposal.id === id)) return;
    setSession({ ...current, positions: { ...current.positions, [id]: position } });
  };
  const approveRows = (rows: DrawingPlacementProposal[]) => {
    const next = [...points];
    const pending = { ...current.pending };
    const dismissed = [...current.dismissed];
    for (const row of rows) {
      if (!proposals.some((proposal) => proposal.id === row.id)) continue;
      if (row.markerXRatio === null || row.markerYRatio === null) continue;
      const position = current.positions[row.id];
      const point = proposalToDrawingPoint(
        row, next, position?.xRatio ?? row.markerXRatio, position?.yRatio ?? row.markerYRatio
      );
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
    // Approved points deleted before save are not approvals.
    const approvedPositions = Object.entries(current.pending).flatMap(([id, pointId]) => {
      const point = savedPoints.find((candidate) => candidate.id === pointId);
      return point ? [{ id, xRatio: point.xRatio, yRatio: point.yRatio }] : [];
    });
    const approvedIds = approvedPositions.map(({ id }) => id);
    setSession((previous) => previous.visualTemplateId === visualTemplateId && previous.processGroup === processGroup
      ? { ...previous, pending: {} }
      : previous);
    if (!visualTemplateId || !approvedIds.length) return;
    void postInspectionDrawingPlacementDecisions(visualTemplateId, { approvedIds, approvedPositions }, clientKey)
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
