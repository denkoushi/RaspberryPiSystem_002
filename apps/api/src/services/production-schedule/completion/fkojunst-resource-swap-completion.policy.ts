import {
  FKOJUNST_MAIL_HIDDEN_INCOMPLETE_STATUS_CODES,
  FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES,
} from './fkojunst-mail-status-completion.policy.js';

export const FKOJUNST_RESOURCE_SWAP_COMPLETE_STATUS = 'C';
export const FKOJUNST_RESOURCE_SWAP_OWN_BLOCKING_STATUS = 'S';
export const FKOJUNST_RESOURCE_SWAP_MULTI_WINNER_OWN_STATUS = 'R';
export const FKOJUNST_RESOURCE_SWAP_LOAD_STATUS_CODES: readonly string[] = [
  ...FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES,
  ...FKOJUNST_MAIL_HIDDEN_INCOMPLETE_STATUS_CODES,
];

type ResourceStatus = {
  statusCode: string;
  sourceUpdatedAt: Date | null;
};

type ResourceSwapCandidate = {
  winnerCount: number;
  otherResourceCount: number;
  own: ResourceStatus | undefined;
  other: ResourceStatus | undefined;
  isOwnResourceExcluded: boolean;
  isOtherResourceExcluded: boolean;
};

/** The caller supplies the deduped statuses and the counts for this ProductNo and FKOJUN. */
function isEligibleResourceSwap(params: ResourceSwapCandidate): boolean {
  const { otherResourceCount, own, other, isOwnResourceExcluded, isOtherResourceExcluded } = params;
  return otherResourceCount === 1
    && !isOwnResourceExcluded
    && !isOtherResourceExcluded
    && other !== undefined
    && other.sourceUpdatedAt !== null
    && (own === undefined || (
      own.statusCode !== FKOJUNST_RESOURCE_SWAP_OWN_BLOCKING_STATUS
      && own.sourceUpdatedAt !== null
      && other.sourceUpdatedAt >= own.sourceUpdatedAt
    ));
}

export function isFkojunstResourceSwapComplete(params: ResourceSwapCandidate): boolean {
  return params.other?.statusCode === FKOJUNST_RESOURCE_SWAP_COMPLETE_STATUS
    && (params.winnerCount === 1 || (params.winnerCount > 1 && params.own?.statusCode === FKOJUNST_RESOURCE_SWAP_MULTI_WINNER_OWN_STATUS))
    && isEligibleResourceSwap(params);
}

export function resolveFkojunstResourceSwapLoadResourceCd(params: ResourceSwapCandidate & {
  other: (ResourceStatus & { resourceCd: string }) | undefined;
  isOtherResourceInMaster: boolean;
  isCompleted: boolean;
}): string | null {
  const { other } = params;
  return other && params.winnerCount === 1 && !params.isCompleted && params.isOtherResourceInMaster
    && FKOJUNST_RESOURCE_SWAP_LOAD_STATUS_CODES.includes(other.statusCode) && isEligibleResourceSwap(params)
    ? other.resourceCd : null;
}
