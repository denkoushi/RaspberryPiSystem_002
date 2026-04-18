import { useMutation } from '@tanstack/react-query';

import { createLoanReportGmailDraft, type LoanReportGmailDraftRequest } from '../../../api/backup';

export function useLoanReportDraftMutation() {
  return useMutation({
    mutationFn: (body: LoanReportGmailDraftRequest) => createLoanReportGmailDraft(body),
  });
}
