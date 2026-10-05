import { randomUUID } from 'node:crypto';
import type { AssemblyProcedureDocumentEditLease, Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { runAssemblyTransaction } from './assembly-transaction.js';

export const ASSEMBLY_PROCEDURE_EDIT_LOCKED = 'ASSEMBLY_PROCEDURE_EDIT_LOCKED';
export type AssemblyProcedureEditActor = { holderKey?: string | null; holderToken?: string | null };

const LEASE_DURATION_MS = 5 * 60 * 1000;

export function serializeAssemblyProcedureEditLease(lease: AssemblyProcedureDocumentEditLease) {
  return {
    holderLabel: lease.holderLabel,
    acquiredAt: lease.acquiredAt.toISOString(),
    heartbeatAt: lease.heartbeatAt.toISOString(),
    expiresAt: lease.expiresAt.toISOString()
  };
}

function lockedError(lease: AssemblyProcedureDocumentEditLease) {
  return new ApiError(409, `${lease.holderLabel}が編集中です`, {
    lease: serializeAssemblyProcedureEditLease(lease)
  }, ASSEMBLY_PROCEDURE_EDIT_LOCKED);
}

export class AssemblyProcedureDocumentEditLeaseService {
  async acquire(documentId: string, actor: { holderKey: string; holderLabel: string }, takeover = false, holderToken: string | null = null) {
    return runAssemblyTransaction(async (tx) => {
      // Lock the document, including when the lease row does not exist yet.
      // Concurrent first acquisitions therefore cannot overwrite each other.
      const documents = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AssemblyProcedureDocument" WHERE "id" = ${documentId} FOR UPDATE
      `;
      if (!documents.length) throw new ApiError(404, '手順書が見つかりません');
      const now = new Date();
      const previous = await tx.assemblyProcedureDocumentEditLease.findUnique({ where: { documentId } });
      const active = previous && previous.expiresAt > now;
      const mine = previous?.holderKey === actor.holderKey && previous?.holderToken === holderToken;
      if (active && !mine && !takeover) throw lockedError(previous);
      const token = active && mine && !takeover ? previous.holderToken : randomUUID();
      const lease = await tx.assemblyProcedureDocumentEditLease.upsert({
        where: { documentId },
        create: { documentId, ...actor, holderToken: token, acquiredAt: now, heartbeatAt: now, expiresAt: new Date(now.getTime() + LEASE_DURATION_MS) },
        update: {
          ...actor,
          holderToken: token,
          acquiredAt: active && mine && !takeover ? previous.acquiredAt : now,
          heartbeatAt: now,
          expiresAt: new Date(now.getTime() + LEASE_DURATION_MS)
        }
      });
      return { lease: serializeAssemblyProcedureEditLease(lease), mine: true as const, holderToken: token };
    });
  }

  async release(documentId: string, holderKey: string, holderToken: string | null = null) {
    if (!holderToken) return;
    await prisma.assemblyProcedureDocumentEditLease.deleteMany({ where: { documentId, holderKey, holderToken } });
  }

  async assertCanWrite(documentId: string, holderKey: string | null, tx?: Prisma.TransactionClient, holderToken: string | null = null) {
    const lease = await (tx ?? prisma).assemblyProcedureDocumentEditLease.findUnique({ where: { documentId } });
    // Absence of a lease preserves older clients' editing contract.
    if (lease && lease.expiresAt > new Date() && (lease.holderKey !== holderKey || lease.holderToken !== holderToken)) throw lockedError(lease);
  }
}
