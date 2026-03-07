import type { GlobalRankProposal, GlobalRankProposalItem } from './due-management-scoring.types.js';

export function explainGlobalRankProposalItem(
  proposal: GlobalRankProposal,
  fseiban: string
): GlobalRankProposalItem | null {
  const target = fseiban.trim();
  if (!target) return null;
  return proposal.items.find((item) => item.fseiban === target) ?? null;
}
