import { useQuery } from '@tanstack/react-query';

import { normalizeWorkInstructionPartNumber } from '../../lib/workInstructionRules';
import { getSelfInspectionNonconformities } from '../client';

export function useSelfInspectionNonconformities(
  partNumber: string | null | undefined,
  options: { enabled?: boolean } = {}
) {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  const enabled = Boolean(normalizedPartNumber) && (options.enabled ?? true);

  return useQuery({
    queryKey: ['self-inspection', 'nonconformities', normalizedPartNumber],
    queryFn: ({ signal }) => getSelfInspectionNonconformities(normalizedPartNumber, signal),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: 1
  });
}
