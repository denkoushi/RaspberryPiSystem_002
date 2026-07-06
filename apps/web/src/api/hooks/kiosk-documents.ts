import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { kioskDocumentDetailQueryKey } from '../../features/kiosk/documents/kioskDocumentQueryKeys';
import {
  getKioskDocuments,
  getKioskDocumentDetail,
  uploadKioskDocument,
  deleteKioskDocument,
  patchKioskDocumentEnabled,
  patchKioskDocumentMetadata,
  reprocessKioskDocument,
  triggerKioskDocumentGmailIngest,
  type KioskDocumentSource,
  type KioskDocumentOcrStatus
} from '../client';
import {
  KIOSK_DOCUMENT_DETAIL_GC_TIME_MS,
  KIOSK_DOCUMENT_DETAIL_STALE_TIME_MS
} from '../kioskDocumentDetailQueryOptions';

export function useKioskDocuments(params?: {
  q?: string;
  sourceType?: KioskDocumentSource;
  ocrStatus?: KioskDocumentOcrStatus;
  includeCandidates?: boolean;
  hideDisabled?: boolean;
  fields?: 'summary';
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['kiosk-documents', params],
    queryFn: () => getKioskDocuments(params),
  });
}

export function useKioskDocumentDetail(id: string | null) {
  return useQuery({
    queryKey: kioskDocumentDetailQueryKey(id),
    queryFn: () => getKioskDocumentDetail(id!),
    enabled: Boolean(id),
    staleTime: KIOSK_DOCUMENT_DETAIL_STALE_TIME_MS,
    gcTime: KIOSK_DOCUMENT_DETAIL_GC_TIME_MS,
  });
}

export function useKioskDocumentMutations() {
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: uploadKioskDocument,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteKioskDocument(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-document'] });
    },
  });
  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => patchKioskDocumentEnabled(id, enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
    },
  });
  const patchMetadata = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        displayTitle?: string | null;
        confirmedFhincd?: string | null;
        confirmedDrawingNumber?: string | null;
        confirmedProcessName?: string | null;
        confirmedResourceCd?: string | null;
        confirmedDocumentNumber?: string | null;
        confirmedSummaryText?: string | null;
        documentCategory?: string | null;
      };
    }) => patchKioskDocumentMetadata(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-document'] });
    },
  });
  const reprocess = useMutation({
    mutationFn: (id: string) => reprocessKioskDocument(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
      void queryClient.invalidateQueries({ queryKey: ['kiosk-document'] });
    },
  });
  const ingestGmail = useMutation({
    mutationFn: (params?: { scheduleId?: string }) => triggerKioskDocumentGmailIngest(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-documents'] });
    },
  });
  return { upload, remove, setEnabled, patchMetadata, reprocess, ingestGmail };
}
