export type ActualHoursWinnerSnapshot = {
  rawId: string;
  explicitUpdatedAt: Date | null;
  workDate: Date;
  rawUpdatedAt: Date;
  rawCreatedAt: Date;
};

const compareDateDesc = (left: Date | null, right: Date | null): number => {
  if (left && right) {
    return left.getTime() - right.getTime();
  }
  if (left && !right) {
    return 1;
  }
  if (!left && right) {
    return -1;
  }
  return 0;
};

export const compareActualHoursWinner = (
  candidate: ActualHoursWinnerSnapshot,
  current: ActualHoursWinnerSnapshot
): number => {
  const explicitCompare = compareDateDesc(candidate.explicitUpdatedAt, current.explicitUpdatedAt);
  if (explicitCompare !== 0) {
    return explicitCompare;
  }
  const workDateCompare = candidate.workDate.getTime() - current.workDate.getTime();
  if (workDateCompare !== 0) {
    return workDateCompare;
  }
  const rawUpdatedCompare = candidate.rawUpdatedAt.getTime() - current.rawUpdatedAt.getTime();
  if (rawUpdatedCompare !== 0) {
    return rawUpdatedCompare;
  }
  const rawCreatedCompare = candidate.rawCreatedAt.getTime() - current.rawCreatedAt.getTime();
  if (rawCreatedCompare !== 0) {
    return rawCreatedCompare;
  }
  return candidate.rawId.localeCompare(current.rawId);
};

export const shouldReplaceActualHoursWinner = (
  candidate: ActualHoursWinnerSnapshot,
  current: ActualHoursWinnerSnapshot
): boolean => compareActualHoursWinner(candidate, current) > 0;
