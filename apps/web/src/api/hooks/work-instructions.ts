import { useQuery } from '@tanstack/react-query';

import { normalizeWorkInstructionPartNumber } from '../../lib/workInstructionRules';
import {
  getWorkInstructionGroup,
  getWorkInstructionGroupsByPartNumber
} from '../client';

function normalizeWorkInstructionTarget(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value.normalize('NFKC').trim().toUpperCase();
}

export function useWorkInstructionGroups(partNumber: string | null | undefined) {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);

  return useQuery({
    queryKey: ['work-instructions', 'groups', normalizedPartNumber],
    queryFn: () => getWorkInstructionGroupsByPartNumber(normalizedPartNumber),
    enabled: Boolean(normalizedPartNumber)
  });
}

export function useWorkInstructionGroup(
  partNumber: string | null | undefined,
  shootingTarget: string | null | undefined
) {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  const normalizedShootingTarget = normalizeWorkInstructionTarget(shootingTarget);
  const enabled = Boolean(normalizedPartNumber && normalizedShootingTarget);

  return useQuery({
    queryKey: ['work-instructions', 'group', normalizedPartNumber, normalizedShootingTarget],
    queryFn: () => getWorkInstructionGroup(normalizedPartNumber, normalizedShootingTarget),
    enabled
  });
}
