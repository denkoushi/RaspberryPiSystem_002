import { useMutation } from '@tanstack/react-query';

import { createLoanReportGmailSend, type LoanReportGmailSendRequest } from '../../../api/backup';

export function useLoanReportSendMutation() {
  return useMutation({
    mutationFn: (body: LoanReportGmailSendRequest) => createLoanReportGmailSend(body),
  });
}
