import { useQuery } from '@tanstack/react-query';

import { normalizeWorkInstructionPartNumber } from '../../lib/workInstructionRules';
import {
  getProcedureManualsByPart,
  getWorkInstructionEditorGroup,
  getWorkInstructionGroup,
  getWorkInstructionGroupsByPartNumber
} from '../client';
import { workInstructionsQueryKeys } from '../queryKeys/workInstructions';

function normalizeWorkInstructionTarget(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value.normalize('NFKC').trim().toUpperCase();
}

export function useWorkInstructionGroups(partNumber: string | null | undefined) {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);

  return useQuery({
    queryKey: workInstructionsQueryKeys.groups(normalizedPartNumber),
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
    queryKey: workInstructionsQueryKeys.group(normalizedPartNumber, normalizedShootingTarget),
    queryFn: () => getWorkInstructionGroup(normalizedPartNumber, normalizedShootingTarget),
    enabled
  });
}

export function useWorkInstructionEditorGroup(
  partNumber: string | null | undefined,
  shootingTarget: string | null | undefined
) {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  const normalizedShootingTarget = normalizeWorkInstructionTarget(shootingTarget);
  const enabled = Boolean(normalizedPartNumber && normalizedShootingTarget);

  return useQuery({
    queryKey: workInstructionsQueryKeys.editorGroup(normalizedPartNumber, normalizedShootingTarget),
    queryFn: () => getWorkInstructionEditorGroup({
      partNumber: normalizedPartNumber,
      shootingTarget: normalizedShootingTarget
    }),
    enabled
  });
}

export function useProcedureManualsByPart(partNumber: string) {
  const key = normalizeWorkInstructionPartNumber(partNumber);
  return useQuery({ queryKey: workInstructionsQueryKeys.procedureManualsByPart(key), queryFn: () => getProcedureManualsByPart(key), enabled: Boolean(key), retry: false });
}
