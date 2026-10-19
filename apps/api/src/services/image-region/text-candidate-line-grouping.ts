import type { TextCandidate, TextCandidateBounds } from './text-candidate.port.js';

const MIN_VERTICAL_OVERLAP_RATIO = 0.5;
const MAX_HORIZONTAL_GAP_HEIGHT_RATIO = 1.5;

type PositionedCandidate = {
  candidate: TextCandidate;
  bounds: TextCandidateBounds;
  inputIndex: number;
};

type CandidateLine = {
  anchor: TextCandidateBounds;
  candidates: PositionedCandidate[];
};

function right(bounds: TextCandidateBounds): number {
  return bounds.xRatio + bounds.widthRatio;
}

function bottom(bounds: TextCandidateBounds): number {
  return bounds.yRatio + bounds.heightRatio;
}

function centerY(bounds: TextCandidateBounds): number {
  return bounds.yRatio + bounds.heightRatio / 2;
}

function verticalOverlapRatio(
  left: TextCandidateBounds,
  rightBounds: TextCandidateBounds
): number {
  const overlap = Math.max(
    0,
    Math.min(bottom(left), bottom(rightBounds)) -
      Math.max(left.yRatio, rightBounds.yRatio)
  );
  return overlap / Math.min(left.heightRatio, rightBounds.heightRatio);
}

function unionBounds(candidates: PositionedCandidate[]): TextCandidateBounds {
  const left = Math.min(...candidates.map(({ bounds }) => bounds.xRatio));
  const top = Math.min(...candidates.map(({ bounds }) => bounds.yRatio));
  const rightEdge = Math.max(...candidates.map(({ bounds }) => right(bounds)));
  const bottomEdge = Math.max(...candidates.map(({ bounds }) => bottom(bounds)));
  return {
    xRatio: left,
    yRatio: top,
    widthRatio: rightEdge - left,
    heightRatio: bottomEdge - top
  };
}

function minimumConfidence(candidates: PositionedCandidate[]): number | null {
  const values = candidates.map(({ candidate }) => candidate.confidence);
  if (!values.every((value): value is number => value !== null && Number.isFinite(value))) {
    return null;
  }
  return Math.min(...values);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, rightValue) => left - rightValue);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function combineCandidates(
  candidates: PositionedCandidate[],
  separator: string
): TextCandidate {
  const first = candidates[0].candidate;
  return {
    text: candidates.map(({ candidate }) => candidate.text).join(separator),
    confidence: minimumConfidence(candidates),
    bounds: unionBounds(candidates),
    pageIndex: first.pageIndex,
    source: first.source
  };
}

/**
 * Builds deterministic horizontal text candidates from coordinate OCR
 * fragments. Inputs that cannot be grouped safely are returned unchanged.
 */
export function groupTextCandidates(
  candidates: TextCandidate[],
  coordinateWidthToHeightRatio = 1
): TextCandidate[] {
  if (candidates.length < 2) return candidates;
  const aspectRatio =
    Number.isFinite(coordinateWidthToHeightRatio) && coordinateWidthToHeightRatio > 0
      ? coordinateWidthToHeightRatio
      : 1;

  const first = candidates[0];
  if (
    first.source === 'none' ||
    candidates.some(
      (candidate) =>
        candidate.bounds === null ||
        candidate.source !== first.source ||
        candidate.pageIndex !== first.pageIndex
    )
  ) {
    return candidates;
  }

  const positioned = candidates
    .map((candidate, inputIndex): PositionedCandidate => ({
      candidate,
      bounds: candidate.bounds as TextCandidateBounds,
      inputIndex
    }))
    .sort(
      (left, rightValue) =>
        centerY(left.bounds) - centerY(rightValue.bounds) ||
        left.bounds.xRatio - rightValue.bounds.xRatio ||
        left.inputIndex - rightValue.inputIndex
    );

  const lines: CandidateLine[] = [];
  for (const item of positioned) {
    const matches = lines
      .map((line) => ({
        line,
        overlap: verticalOverlapRatio(line.anchor, item.bounds),
        centerDistance: Math.abs(centerY(line.anchor) - centerY(item.bounds))
      }))
      .filter(({ overlap }) => overlap >= MIN_VERTICAL_OVERLAP_RATIO)
      .sort(
        (left, rightValue) =>
          rightValue.overlap - left.overlap ||
          left.centerDistance - rightValue.centerDistance
      );
    if (matches[0]) {
      matches[0].line.candidates.push(item);
    } else {
      lines.push({ anchor: item.bounds, candidates: [item] });
    }
  }

  const segments = lines
    .sort(
      (left, rightValue) =>
        centerY(left.anchor) - centerY(rightValue.anchor) ||
        left.anchor.xRatio - rightValue.anchor.xRatio
    )
    .flatMap((line) => {
      const ordered = [...line.candidates].sort(
        (left, rightValue) =>
          left.bounds.xRatio - rightValue.bounds.xRatio ||
          left.inputIndex - rightValue.inputIndex
      );
      const representativeHeight = median(
        ordered.map(({ bounds }) => bounds.heightRatio)
      );
      const representativeHeightInXUnits = representativeHeight / aspectRatio;
      const lineSegments: PositionedCandidate[][] = [];
      for (const item of ordered) {
        const current = lineSegments[lineSegments.length - 1];
        const previous = current?.[current.length - 1];
        if (
          !current ||
          item.bounds.xRatio - right(previous.bounds) >
            representativeHeightInXUnits * MAX_HORIZONTAL_GAP_HEIGHT_RATIO
        ) {
          lineSegments.push([item]);
        } else {
          current.push(item);
        }
      }
      return lineSegments;
    });

  if (!segments.some((segment) => segment.length >= 2)) return candidates;

  const segmentCandidates = segments.map((segment) => combineCandidates(segment, ''));
  const fullCandidate = combineCandidates(segments.flatMap((segment) => segment), '');
  fullCandidate.text = segmentCandidates.map(({ text }) => text).join('\n');
  const output = [fullCandidate, ...segmentCandidates];
  return output.filter(
    (candidate, index) =>
      output.findIndex(({ text }) => text === candidate.text) === index
  );
}
