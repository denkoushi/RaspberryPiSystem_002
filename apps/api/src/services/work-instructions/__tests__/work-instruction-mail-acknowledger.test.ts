import { describe, expect, it, vi } from 'vitest';

import type { WorkInstructionRepository } from '../repositories/work-instruction-repository.port.js';
import { acknowledgeWorkInstructionMessage } from '../work-instruction-mail-acknowledger.js';

function repository(events: string[]) {
  return {
    recordImportMessage: vi.fn(async (input: { mailCleanupPending?: boolean }) => {
      events.push(`record:${input.mailCleanupPending === true}`);
      return {};
    }),
  } as unknown as WorkInstructionRepository;
}

describe('acknowledgeWorkInstructionMessage', () => {
  it('does not mutate Gmail when the terminal outcome cannot be recorded first', async () => {
    const repo = {
      recordImportMessage: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    } as unknown as WorkInstructionRepository;
    const gmail = {
      markAsRead: vi.fn(),
      trashMessage: vi.fn(),
    };

    await expect(acknowledgeWorkInstructionMessage({
      repository: repo,
      gmail,
      messageId: 'mail-record-failure',
      outcome: 'INVALID',
      error: 'invalid manifest',
    })).rejects.toThrow('database unavailable');

    expect(gmail.markAsRead).not.toHaveBeenCalled();
    expect(gmail.trashMessage).not.toHaveBeenCalled();
  });

  it('records the terminal outcome before Gmail mutation and clears pending afterward', async () => {
    const events: string[] = [];
    const repo = repository(events);
    const gmail = {
      markAsRead: vi.fn(async () => { events.push('read'); }),
      trashMessage: vi.fn(async () => { events.push('trash'); }),
    };

    const result = await acknowledgeWorkInstructionMessage({
      repository: repo,
      gmail,
      messageId: 'mail-1',
      outcome: 'APPLIED',
    });

    expect(result).toEqual({ outcome: 'APPLIED', acknowledged: true });
    expect(events).toEqual(['record:true', 'read', 'trash', 'record:false']);
  });

  it('treats a Gmail 404 as already acknowledged without retrying trash', async () => {
    const events: string[] = [];
    const repo = repository(events);
    const gmail = {
      markAsRead: vi.fn(async () => {
        const error = new Error('message no longer exists') as Error & { status: number };
        error.status = 404;
        throw error;
      }),
      trashMessage: vi.fn(),
    };

    const result = await acknowledgeWorkInstructionMessage({
      repository: repo,
      gmail,
      messageId: 'mail-2',
      outcome: 'DUPLICATE',
    });

    expect(result.acknowledged).toBe(true);
    expect(gmail.trashMessage).not.toHaveBeenCalled();
    expect(events).toEqual(['record:true', 'record:false']);
  });

  it('retains terminal state and pending cleanup when Gmail mutation fails', async () => {
    const events: string[] = [];
    const repo = repository(events);
    const gmail = {
      markAsRead: vi.fn(async () => { events.push('read'); }),
      trashMessage: vi.fn(async () => {
        events.push('trash');
        throw new Error('rate limited');
      }),
    };

    const result = await acknowledgeWorkInstructionMessage({
      repository: repo,
      gmail,
      messageId: 'mail-3',
      outcome: 'STALE',
      error: 'warning',
    });

    expect(result.acknowledgementPending).toBe(true);
    expect(result.error).toContain('mail cleanup: rate limited');
    expect(events).toEqual(['record:true', 'read', 'trash', 'record:true']);
  });
});
