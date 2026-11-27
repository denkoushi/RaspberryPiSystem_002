import { useQuery } from '@tanstack/react-query';

import { getAssemblyProcedureDocumentFeedback } from '../domains/assembly/procedure-documents';

export function useAssemblyProcedureDocumentFeedback(id: string | null | undefined) {
  return useQuery({
    queryKey: ['assembly', 'procedure-document-feedback', id],
    queryFn: ({ signal }) => getAssemblyProcedureDocumentFeedback(id!, signal),
    enabled: Boolean(id),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
