import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { loanEventFingerprint, resolveLoanReadAt, runLoanEvent } from '../loan-event.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { transaction: { findFirst: vi.fn() } } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const eventKey = '22222222-2222-4222-8222-222222222222';
const readAt = new Date('2026-11-03T09:00:00Z');
const findFirst = vi.mocked(prisma.transaction.findFirst);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('loanEventFingerprint', () => {

  it('ignores eventKey and clientId so the same offline payload replays from any key/client field', () => {
    const base = loanEventFingerprint({ readAt, note: 'x' } as never, 'tool.borrow');
    expect(loanEventFingerprint({ readAt, note: 'x', eventKey } as never, 'tool.borrow')).toBe(base);
    expect(loanEventFingerprint({ readAt, note: 'x', clientId: 'kiosk-a' } as never, 'tool.borrow')).toBe(base);
    expect(loanEventFingerprint({ readAt, note: 'x', clientId: 'kiosk-b', eventKey: 'other' } as never, 'tool.borrow')).toBe(base);
  });

  it('distinguishes operations, payload fields and read times', () => {
    const base = loanEventFingerprint({ readAt, note: 'x' } as never, 'tool.borrow');
    expect(loanEventFingerprint({ readAt, note: 'x' } as never, 'tool.return')).not.toBe(base);
    expect(loanEventFingerprint({ readAt, note: 'y' } as never, 'tool.borrow')).not.toBe(base);
    expect(loanEventFingerprint({ readAt: new Date(readAt.getTime() + 1), note: 'x' } as never, 'tool.borrow')).not.toBe(base);
    expect(loanEventFingerprint({ note: 'x' } as never, 'tool.borrow')).not.toBe(base);
  });

  it('treats an explicitly undefined field the same as an absent one (JSON drops undefined)', () => {
    expect(loanEventFingerprint({ readAt, note: undefined } as never, 'tool.borrow'))
      .toBe(loanEventFingerprint({ readAt } as never, 'tool.borrow'));
    // null is serialized, so it is a different request from an omitted note.
    expect(loanEventFingerprint({ readAt, note: null } as never, 'tool.borrow'))
      .not.toBe(loanEventFingerprint({ readAt } as never, 'tool.borrow'));
  });
});

describe('resolveLoanReadAt', () => {
  it('uses the current clock as reception time when none is given', () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-03T12:00:00Z');
    vi.setSystemTime(now);
    expect(resolveLoanReadAt(undefined)).toEqual({ eventAt: now, receivedAt: now });
    const offlineRead = new Date('2026-11-01T08:30:00Z');
    expect(resolveLoanReadAt(offlineRead)).toEqual({ eventAt: offlineRead, receivedAt: now });
  });

});

describe('runLoanEvent', () => {
  it('runs the operation directly without any lookup when no eventKey is sent (online request)', async () => {
    const execute = vi.fn().mockResolvedValue({ id: 'loan' });
    await expect(runLoanEvent({ readAt }, undefined, 'tool.borrow', execute)).resolves.toEqual({ id: 'loan' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('looks up the replay by (clientId, eventKey) and includes every asset relation', async () => {
    findFirst.mockResolvedValue(null);
    const execute = vi.fn().mockResolvedValue({ id: 'new' });
    await runLoanEvent({ eventKey, readAt }, 'client-1', 'tool.borrow', execute);
    expect(findFirst).toHaveBeenCalledWith({
      where: { clientId: 'client-1', eventKey },
      include: { loan: { include: { item: true, measuringInstrument: true, riggingGear: true, employee: true, client: true } } },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not treat the same eventKey from another client as a replay (key scope is per client)', async () => {
    findFirst.mockImplementation((async ({ where }: { where: { clientId: string } }) =>
      where.clientId === 'client-1'
        ? { eventFingerprint: loanEventFingerprint({ eventKey, readAt }, 'tool.borrow'), loan: { id: 'first' } }
        : null) as never);
    const execute = vi.fn().mockResolvedValue({ id: 'second' });
    await expect(runLoanEvent({ eventKey, readAt }, 'client-2', 'tool.borrow', execute)).resolves.toEqual({ id: 'second' });
    await expect(runLoanEvent({ eventKey, readAt }, 'client-1', 'tool.borrow', execute)).resolves.toEqual({ id: 'first' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

});
