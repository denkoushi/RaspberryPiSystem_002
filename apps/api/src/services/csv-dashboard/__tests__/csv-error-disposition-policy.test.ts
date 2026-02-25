import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { GmailRateLimitedDeferredError } from '../../backup/gmail-request-gate.service.js';
import { CsvErrorDispositionPolicy } from '../csv-error-disposition-policy.js';

describe('CsvErrorDispositionPolicy', () => {
  const policy = new CsvErrorDispositionPolicy();

  it('GmailRateLimitedDeferredError は RETRIABLE', () => {
    const error = new GmailRateLimitedDeferredError({
      cooldownUntil: new Date('2026-01-01T00:00:00.000Z'),
      retryAfterMs: 1000,
      operation: 'gmail.messages.list',
    });
    expect(policy.classify(error)).toBe('RETRIABLE');
  });

  it('CSV_HEADER_MISMATCH は NON_RETRIABLE', () => {
    const error = new ApiError(400, 'header mismatch', undefined, 'CSV_HEADER_MISMATCH');
    expect(policy.classify(error)).toBe('NON_RETRIABLE');
  });

  it('ProductionScheduleの形式エラー文言は NON_RETRIABLE', () => {
    const error = new ApiError(400, '仕番は10桁の数字である必要があります', undefined, 'CSV_INGEST_FAILED');
    expect(policy.classify(error)).toBe('NON_RETRIABLE');
  });

  it('その他は RETRIABLE', () => {
    const error = new Error('temporary network error');
    expect(policy.classify(error)).toBe('RETRIABLE');
  });
});

