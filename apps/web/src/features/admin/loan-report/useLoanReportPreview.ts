import { useQuery } from '@tanstack/react-query';

import { getLoanReportPreview, type LoanReportPreviewQuery } from '../../../api/backup';

export function useLoanReportPreview(params: LoanReportPreviewQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['loan-report-preview', params],
    enabled,
    queryFn: async () => getLoanReportPreview(params),
  });
}
