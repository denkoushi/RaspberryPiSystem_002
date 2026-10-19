import { describe, expect, it } from 'vitest';

import {
  allocateWorkInstructionBatch,
  buildWorkInstructionGmailSearchQuery,
  escapeGmailQuotedSearchValue,
} from '../work-instruction-ingestion.policy.js';

describe('work-instruction ingestion allocation policy', () => {
  it('reserves ten new and ten retry messages for a twenty-message cycle', () => {
    const selected = allocateWorkInstructionBatch(
      Array.from({ length: 20 }, (_, index) => `new-${index}`),
      Array.from({ length: 20 }, (_, index) => `retry-${index}`),
    );

    expect(selected.newIds).toEqual(Array.from({ length: 10 }, (_, index) => `new-${index}`));
    expect(selected.retryIds).toEqual(Array.from({ length: 10 }, (_, index) => `retry-${index}`));
    expect(selected.newIds.length + selected.retryIds.length).toBe(20);
  });

  it('reallocates unused reservation slots while keeping the total at twenty', () => {
    const selected = allocateWorkInstructionBatch(
      ['new-1'],
      Array.from({ length: 20 }, (_, index) => `retry-${index}`),
    );

    expect(selected.newIds).toEqual(['new-1']);
    expect(selected.retryIds).toHaveLength(19);
    expect(selected.newIds.length + selected.retryIds.length).toBe(20);
  });
});

describe('buildWorkInstructionGmailSearchQuery', () => {
  it('escapes backslashes before quotes in quoted Gmail search values', () => {
    expect(escapeGmailQuotedSearchValue(String.raw`prefix\"suffix`)).toBe(
      String.raw`prefix\\\"suffix`,
    );
  });

  it('limits fresh intake to unread inbox messages and the canonical token', () => {
    expect(buildWorkInstructionGmailSearchQuery({
      subjectTokens: ['[Kakou-Dandori-photo]'],
    })).toBe('(subject:"[Kakou-Dandori-photo]") in:inbox is:unread');
  });
});
