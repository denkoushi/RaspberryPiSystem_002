import type { getKioskDocuments } from '../client';

export const kioskDocumentsQueryKeys = {
  documentsAll: ['kiosk-documents'] as const,
  documents: (params?: Parameters<typeof getKioskDocuments>[0]) => ['kiosk-documents', params] as const,
  documentAll: ['kiosk-document'] as const,
};
