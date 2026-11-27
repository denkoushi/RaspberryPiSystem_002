import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAssemblyProcedureDocumentFeedback, setAssemblyProcedureDocumentFeedbackTarget } from '../domains/assembly/procedure-documents';

const feedbackKey = (id: string | null | undefined) => ['assembly', 'procedure-document-feedback', id] as const;

export function useAssemblyProcedureDocumentFeedback(id: string | null | undefined) {
  return useQuery({
    queryKey: feedbackKey(id),
    queryFn: ({ signal }) => getAssemblyProcedureDocumentFeedback(id!, signal),
    enabled: Boolean(id),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useSetAssemblyProcedureDocumentFeedbackTarget(id: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nightlyTarget: boolean) => setAssemblyProcedureDocumentFeedbackTarget(id!, nightlyTarget),
    onSuccess: (data) => queryClient.setQueryData(feedbackKey(id), data),
  });
}
