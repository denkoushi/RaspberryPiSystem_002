import { createHash } from 'node:crypto';
import type { Loan } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueConstraintViolation } from './loan-concurrency.js';

export interface LoanEventInput {
  eventKey?: string;
  readAt?: Date;
}

export function resolveLoanReadAt(readAt?: Date, receivedAt = new Date()): { eventAt: Date; receivedAt: Date } {
  if (!readAt) return { eventAt: receivedAt, receivedAt };
  const delta = readAt.getTime() - receivedAt.getTime();
  if (!Number.isFinite(delta) || delta >= 5 * 60_000 || delta < -7 * 24 * 60 * 60_000) {
    logger.warn({ readAt, receivedAt }, 'Loan readAt outside allowed range; using server time');
    return { eventAt: receivedAt, receivedAt };
  }
  return { eventAt: readAt, receivedAt };
}

export function loanEventFingerprint(input: LoanEventInput, operation: string): string {
  const body = Object.fromEntries(Object.entries(input)
    .filter(([key]) => key !== 'eventKey' && key !== 'clientId')
    .sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex');
}

// The unique key and fingerprint follow photo-borrow's lookup/create/conflict lookup pattern.
// Transaction retains the originating client even when another kiosk returns the loan and Loan.clientId changes.
export async function runLoanEvent<T extends Loan>(
  input: LoanEventInput,
  clientId: string | undefined,
  operation: string,
  execute: () => Promise<T>,
): Promise<T> {
  if (!input.eventKey) return execute();
  if (!clientId) throw new ApiError(400, 'eventKeyを使用する場合はクライアント端末の特定が必要です');
  const fingerprint = loanEventFingerprint(input, operation);
  const include = { item: true, measuringInstrument: true, riggingGear: true, employee: true, client: true };
  const lookup = async (): Promise<T | null> => {
    const existing = await prisma.transaction.findFirst({
      where: { clientId, eventKey: input.eventKey }, include: { loan: { include } },
    });
    if (!existing) return null;
    if (existing.eventFingerprint !== fingerprint) {
      throw new ApiError(409, '同じeventKeyが異なるリクエストに使用されました', undefined, 'EVENT_KEY_REUSED');
    }
    return existing.loan as T | null;
  };
  const existing = await lookup();
  if (existing) return existing;
  try {
    return await execute();
  } catch (error) {
    // Active-asset helpers translate P2002 to 409, and concurrent returns can lose the state claim.
    if (isUniqueConstraintViolation(error) || (error instanceof ApiError && error.statusCode === 409)) {
      const winner = await lookup();
      if (winner) return winner;
    }
    throw error;
  }
}
