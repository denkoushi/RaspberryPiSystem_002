import { KNOWLEDGE_POSITION_RANKS, type KnowledgePositionRank } from '@raspi-system/shared-types';

export { KNOWLEDGE_POSITION_RANKS };
export function positionRank(value: string | null | undefined): KnowledgePositionRank {
  return KNOWLEDGE_POSITION_RANKS.find(rank => rank === value) ?? 'general';
}
export function canApprove(rank: KnowledgePositionRank): boolean {
  return KNOWLEDGE_POSITION_RANKS.indexOf(rank) >= KNOWLEDGE_POSITION_RANKS.indexOf('leader');
}

export type KnowledgeReviewEmployee = {
  id: string; employeeCode: string; displayName: string; nfcTagUid: string; positionName: string | null; rank: KnowledgePositionRank;
};
