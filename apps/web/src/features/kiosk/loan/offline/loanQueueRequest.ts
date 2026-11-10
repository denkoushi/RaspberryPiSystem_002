import {
  getResolvedClientKey, borrowMeasuringInstrument, returnMeasuringInstrument,
  borrowRiggingGear, returnRiggingGear, borrowItem, returnLoan,
} from '../../../../api/client';

import type {
  BorrowPayload, ReturnPayload, MeasuringInstrumentBorrowPayload, MeasuringInstrumentReturnPayload,
  RiggingBorrowPayload, RiggingReturnPayload,
} from '../../../../api/types';

type Request =
  | { route: 'toolBorrow'; body: BorrowPayload }
  | { route: 'toolReturn'; body: ReturnPayload }
  | { route: 'instrumentBorrow'; body: MeasuringInstrumentBorrowPayload }
  | { route: 'instrumentReturn'; body: MeasuringInstrumentReturnPayload }
  | { route: 'riggingBorrow'; body: RiggingBorrowPayload }
  | { route: 'riggingReturn'; body: RiggingReturnPayload };
export type LoanQueueRequest = Request & { body: { eventKey: string; readAt: string } };
export type LoanRequest = Request;

export function sendLoanRequest(request: LoanQueueRequest) {
  const clientKey = getResolvedClientKey();
  switch (request.route) {
    case 'toolBorrow': return borrowItem(request.body, clientKey);
    case 'toolReturn': return returnLoan(request.body, clientKey);
    case 'instrumentBorrow': return borrowMeasuringInstrument(request.body, clientKey);
    case 'instrumentReturn': return returnMeasuringInstrument(request.body, clientKey);
    case 'riggingBorrow': return borrowRiggingGear(request.body, clientKey);
    case 'riggingReturn': return returnRiggingGear(request.body, clientKey);
  }
}
