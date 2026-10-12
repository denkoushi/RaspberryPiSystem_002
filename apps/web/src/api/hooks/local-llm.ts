import { useQuery } from '@tanstack/react-query';

import { getLocalLlmAvailability } from '../domains/system';

export function useLocalLlmAvailability() {
  const query = useQuery({
    queryKey: ['local-llm-availability'],
    queryFn: ({ signal }) => getLocalLlmAvailability(signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: 'always',
    staleTime: 10_000,
    retry: false
  });
  return { unavailable: query.isSuccess && query.data?.available === false };
}
