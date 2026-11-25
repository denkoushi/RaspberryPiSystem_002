export const FKOJUNST_RESOURCE_SWAP_COMPLETE_STATUS = 'C';
export const FKOJUNST_RESOURCE_SWAP_OWN_BLOCKING_STATUS = 'S';

type ResourceStatus = {
  statusCode: string;
  sourceUpdatedAt: Date | null;
};

/** The caller supplies the deduped statuses and the counts for this ProductNo and FKOJUN. */
export function isFkojunstResourceSwapComplete(params: {
  winnerCount: number;
  otherResourceCount: number;
  own: ResourceStatus | undefined;
  other: ResourceStatus;
  isOwnResourceExcluded: boolean;
  isOtherResourceExcluded: boolean;
}): boolean {
  const { winnerCount, otherResourceCount, own, other, isOwnResourceExcluded, isOtherResourceExcluded } = params;
  return winnerCount === 1
    && otherResourceCount === 1
    && !isOwnResourceExcluded
    && !isOtherResourceExcluded
    && other.statusCode === FKOJUNST_RESOURCE_SWAP_COMPLETE_STATUS
    && other.sourceUpdatedAt !== null
    && (own === undefined || (
      own.statusCode !== FKOJUNST_RESOURCE_SWAP_OWN_BLOCKING_STATUS
      && own.sourceUpdatedAt !== null
      && other.sourceUpdatedAt >= own.sourceUpdatedAt
    ));
}
