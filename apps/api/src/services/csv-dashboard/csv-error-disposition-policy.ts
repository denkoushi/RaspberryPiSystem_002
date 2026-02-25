import { ApiError } from '../../lib/errors.js';
import { GmailRateLimitedDeferredError } from '../backup/gmail-request-gate.service.js';

export type CsvErrorDisposition = 'RETRIABLE' | 'NON_RETRIABLE';

export class CsvErrorDispositionPolicy {
  classify(error: unknown): CsvErrorDisposition {
    if (error instanceof GmailRateLimitedDeferredError) {
      return 'RETRIABLE';
    }

    if (error instanceof ApiError) {
      if (error.code === 'CSV_HEADER_MISMATCH') {
        return 'NON_RETRIABLE';
      }
      const message = (error.message || '').toLowerCase();
      if (message.includes('csvのパースに失敗')) {
        return 'NON_RETRIABLE';
      }
      if (message.includes('10桁の数字である必要があります')) {
        return 'NON_RETRIABLE';
      }
      if (message.includes('英数字8桁である必要があります')) {
        return 'NON_RETRIABLE';
      }
    }

    return 'RETRIABLE';
  }
}

