import { createHash } from 'node:crypto';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueConstraintViolation } from '../loan/loan-concurrency.js';
import { resolveLoanReadAt } from '../loan/loan-event.js';

export interface PalletEventInput {
  eventKey?: string;
  readAt?: Date;
}

type Input = PalletEventInput & {
  clientDeviceId: string;
  machineCd?: string;
  palletNo?: number;
  itemId?: string;
  manufacturingOrderBarcodeRaw: string;
};

export function palletEventFingerprint(input: Input, operation: string): string {
  const body = Object.fromEntries(Object.entries(input)
    .filter(([key]) => key !== 'eventKey' && key !== 'clientDeviceId')
    .sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify({ operation, body })).digest('hex');
}

export async function runPalletEvent(
  input: Input,
  operation: string,
  execute: (event: PalletEventInput & { eventFingerprint?: string }) => Promise<{ id: string }>,
): Promise<{ id: string }> {
  const fingerprint = palletEventFingerprint(input, operation);
  const lookup = async () => {
    const existing = await prisma.machinePalletEvent.findFirst({
      where: { clientDeviceId: input.clientDeviceId, eventKey: input.eventKey },
    });
    if (!existing) return null;
    if (existing.eventFingerprint !== fingerprint) {
      throw new ApiError(409, '同じeventKeyが異なるリクエストに使用されました', undefined, 'EVENT_KEY_REUSED');
    }
    return existing.affectedItemId ? { id: existing.affectedItemId } : null;
  };
  if (input.eventKey) {
    const existing = await lookup();
    if (existing) return existing;
  }
  // The fingerprint keeps the original readAt; only the stored audit time falls back to the server clock.
  const readAt = input.readAt ? resolveLoanReadAt(input.readAt).eventAt : undefined;
  try {
    return await execute({
      ...(input.eventKey ? { eventKey: input.eventKey, eventFingerprint: fingerprint } : {}),
      ...(readAt ? { readAt } : {}),
    });
  } catch (error) {
    if (input.eventKey && (isUniqueConstraintViolation(error) || (error instanceof ApiError && error.statusCode === 409))) {
      const winner = await lookup();
      if (winner) return winner;
    }
    throw error;
  }
}
