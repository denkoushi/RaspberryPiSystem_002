import { normalizeInspectionDrawingMeasurementLabel } from '@raspi-system/shared-types';

export type EvaluationMarker = {
  nominalValue: number | null;
  measurementLabel: string | null;
  markerXRatio: number;
  markerYRatio: number;
};

export type PlacementMetrics = {
  humanCount: number;
  proposalCount: number;
  matched: number;
  positionOk: number;
  precision: number;
  recall: number;
  positionOkRate: number;
};

export function placementRates(counts: Pick<PlacementMetrics, 'humanCount' | 'proposalCount' | 'matched' | 'positionOk'>): PlacementMetrics {
  return {
    ...counts,
    precision: counts.proposalCount ? counts.matched / counts.proposalCount : 0,
    recall: counts.humanCount ? counts.matched / counts.humanCount : 0,
    positionOkRate: counts.humanCount ? counts.positionOk / counts.humanCount : 0
  };
}

// NFKC + the existing label trim; empty labels impose no label constraint.
const label = (value: string | null) => normalizeInspectionDrawingMeasurementLabel((value ?? '').normalize('NFKC'));

export function comparePlacementMarkers(
  proposals: EvaluationMarker[], humans: EvaluationMarker[], positionTolerance = 0.03
): PlacementMetrics {
  if (!Number.isFinite(positionTolerance) || positionTolerance < 0) throw new Error('Invalid position tolerance');
  const pairs = proposals.flatMap((proposal, proposalIndex) => humans.flatMap((human, humanIndex) => {
    if (proposal.nominalValue === null || human.nominalValue === null ||
      Math.abs(proposal.nominalValue - human.nominalValue) > 1e-6) return [];
    const proposalLabel = label(proposal.measurementLabel);
    const humanLabel = label(human.measurementLabel);
    if (proposalLabel && humanLabel && proposalLabel !== humanLabel) return [];
    return [{ proposalIndex, humanIndex, distance: Math.hypot(
      proposal.markerXRatio - human.markerXRatio, proposal.markerYRatio - human.markerYRatio
    ) }];
  })).sort((a, b) => a.distance - b.distance || a.proposalIndex - b.proposalIndex || a.humanIndex - b.humanIndex);
  const usedProposals = new Set<number>();
  const usedHumans = new Set<number>();
  let positionOk = 0;
  for (const pair of pairs) {
    if (usedProposals.has(pair.proposalIndex) || usedHumans.has(pair.humanIndex)) continue;
    usedProposals.add(pair.proposalIndex);
    usedHumans.add(pair.humanIndex);
    if (pair.distance <= positionTolerance) positionOk++;
  }
  return placementRates({
    humanCount: humans.length, proposalCount: proposals.length, matched: usedProposals.size, positionOk
  });
}

export function nominalMatched(proposals: EvaluationMarker[], humans: EvaluationMarker[]): number {
  return comparePlacementMarkers(
    proposals.map((marker) => ({ ...marker, measurementLabel: null })),
    humans.map((marker) => ({ ...marker, measurementLabel: null }))
  ).matched;
}
