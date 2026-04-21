import { describe, expect, it } from 'vitest';
import { extractLoanIdFromEventRaw } from '../extract-loan-id-from-event-raw.js';

describe('extractLoanIdFromEventRaw', () => {
  it('returns trimmed loanId when present', () => {
    expect(extractLoanIdFromEventRaw({ loanId: '  abc-123  ' })).toBe('abc-123');
  });

  it('returns null when loanId is missing', () => {
    expect(extractLoanIdFromEventRaw({ borrower: 'x' })).toBeNull();
  });

  it('returns null when loanId is empty string', () => {
    expect(extractLoanIdFromEventRaw({ loanId: '' })).toBeNull();
    expect(extractLoanIdFromEventRaw({ loanId: '   ' })).toBeNull();
  });

  it('returns null when loanId is not a string', () => {
    expect(extractLoanIdFromEventRaw({ loanId: 1 })).toBeNull();
    expect(extractLoanIdFromEventRaw({ loanId: null })).toBeNull();
  });

  it('returns null for non-object raw', () => {
    expect(extractLoanIdFromEventRaw(null)).toBeNull();
    expect(extractLoanIdFromEventRaw(undefined)).toBeNull();
    expect(extractLoanIdFromEventRaw('x')).toBeNull();
    expect(extractLoanIdFromEventRaw([])).toBeNull();
  });
});
