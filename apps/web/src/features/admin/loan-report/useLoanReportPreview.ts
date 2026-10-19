import { useQuery } from '@tanstack/react-query';

import { getLoanReportPreview, type LoanReportPreviewQuery } from '../../../api/backup';
import { reportsQueryKeys } from '../../../api/queryKeys/reports';

export function useLoanReportPreview(params: LoanReportPreviewQuery, enabled: boolean) {
  return useQuery({
    queryKey: reportsQueryKeys.loanReportPreview(params),
    enabled,
    queryFn: async () => getLoanReportPreview(params),
  });
}
