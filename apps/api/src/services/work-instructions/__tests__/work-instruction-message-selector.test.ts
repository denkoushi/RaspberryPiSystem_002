import { describe, expect, it, vi } from 'vitest';

import type { WorkInstructionImportMessageView } from '../domain/types.js';
import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';
import { selectWorkInstructionMessages } from '../work-instruction-message-selector.js';

const now = new Date('2026-08-29T01:00:00Z');
const config = {
  enabled: true,
  subjectTokens: ['[Kakou-Dandori-photo]'],
};

function record(input: {
  id: string;
  outcome: WorkInstructionImportMessageView['outcome'];
  nextRetryAt?: string | null;
  updatedAt?: string;
  mailCleanupPending?: boolean;
}): WorkInstructionImportMessageView {
  return {
    id: input.id,
    gmailMessageId: input.id,
    outcome: input.outcome,
    error: null,
    nextRetryAt: input.nextRetryAt === undefined || input.nextRetryAt === null
      ? null
      : new Date(input.nextRetryAt),
    mailCleanupPending: input.mailCleanupPending ?? false,
    createdAt: new Date(input.updatedAt ?? '2026-08-29T00:00:00Z'),
    updatedAt: new Date(input.updatedAt ?? '2026-08-29T00:00:00Z'),
  };
}

describe('selectWorkInstructionMessages', () => {
  it('deduplicates retry sources and preserves the oldest due order', async () => {
    const retryMid = record({
      id: 'retry-mid',
      outcome: 'RETRYABLE',
      nextRetryAt: '2026-08-29T00:20:00Z',
    });
    const repository = {
      readImportMessages: vi.fn(async (input: {
        mailCleanupPending?: boolean;
        outcome?: string;
        gmailMessageIds?: ReadonlyArray<string>;
      }) => {
        if (input.gmailMessageIds) return [];
        if (input.mailCleanupPending) {
          return [record({
            id: 'ack-old',
            outcome: 'APPLIED',
            nextRetryAt: '2026-08-29T00:10:00Z',
            mailCleanupPending: true,
          }), retryMid];
        }
        if (input.outcome === 'RETRYABLE') {
          return [retryMid, record({
            id: 'retry-new',
            outcome: 'RETRYABLE',
            nextRetryAt: '2026-08-29T00:30:00Z',
          })];
        }
        if (input.outcome === 'PENDING') {
          return [record({
            id: 'pending-old',
            outcome: 'PENDING',
            updatedAt: '2026-08-29T00:40:00Z',
          })];
        }
        return [record({
          id: 'processing-new',
          outcome: 'PROCESSING',
          updatedAt: '2026-08-29T00:50:00Z',
        })];
      }),
    } as unknown as WorkInstructionRepository;
    const gmail = {
      searchMessagesAll: vi.fn(async () => []),
    };

    const selected = await selectWorkInstructionMessages({
      gmail: gmail as never,
      repository,
      config,
      now,
    });

    expect(selected.retryIds).toEqual([
      'ack-old',
      'retry-mid',
      'retry-new',
      'pending-old',
      'processing-new',
    ]);
    expect(new Set(selected.retryIds).size).toBe(selected.retryIds.length);
    expect(gmail.searchMessagesAll).toHaveBeenCalledWith(
      expect.stringContaining('in:inbox is:unread')
    );
  });
});
