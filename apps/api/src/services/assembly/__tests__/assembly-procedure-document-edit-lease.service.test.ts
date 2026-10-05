import { readFileSync } from 'node:fs';
import type { AssemblyProcedureDocumentEditLease, Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { AssemblyProcedureDocumentEditLeaseService, ASSEMBLY_PROCEDURE_EDIT_LOCKED } from '../assembly-procedure-document-edit-lease.service.js';

const documentId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-10-06T03:00:00Z');
const actor = { holderKey: 'user:operator', holderLabel: '編集太郎' };

describe('assembly procedure document editing leases', () => {
  const service = new AssemblyProcedureDocumentEditLeaseService();
  let stored: AssemblyProcedureDocumentEditLease | null;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); stored = null;
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ id: documentId }]);
    vi.spyOn(prisma, '$transaction').mockImplementation((async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(prisma)) as never);
    vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'findUnique').mockImplementation(async () => stored);
    vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'upsert').mockImplementation(async args => {
      stored = { ...(stored ?? args.create), ...args.update } as AssemblyProcedureDocumentEditLease;
      return stored;
    });
    vi.spyOn(prisma.assemblyProcedureDocumentEditLease, 'deleteMany').mockImplementation(async args => {
      if (stored?.holderKey === args?.where?.holderKey && stored?.holderToken === args?.where?.holderToken) { stored = null; return { count: 1 }; }
      return { count: 0 };
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('adds only the lease table, with its cascading foreign key declared in CREATE TABLE', () => {
    const sql = readFileSync(new URL('../../../../prisma/migrations/20261006040000_add_procedure_document_edit_leases/migration.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE "AssemblyProcedureDocumentEditLease"');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('"holderToken" TEXT NOT NULL');
    expect(sql).not.toMatch(/ALTER TABLE|UPDATE\s+"|DELETE FROM|DROP\s/i);
  });

  it('acquires a lease and renews the expiry while preserving the original start', async () => {
    const acquired = await service.acquire(documentId, actor);
    expect(acquired.holderToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(acquired).toMatchObject({ mine: true, lease: { holderLabel: actor.holderLabel, expiresAt: '2026-10-06T03:05:00.000Z' } });
    vi.advanceTimersByTime(30_000);
    expect((await service.acquire(documentId, actor, false, acquired.holderToken)).lease).toMatchObject({ acquiredAt: now.toISOString(), heartbeatAt: '2026-10-06T03:00:30.000Z', expiresAt: '2026-10-06T03:05:30.000Z' });
    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.arrayContaining([expect.stringContaining('FOR UPDATE')]), documentId);
  });

  it('rejects another holder and leaves both lease and timestamps unchanged', async () => {
    await service.acquire(documentId, actor);
    const before = { ...stored };
    await expect(service.acquire(documentId, { holderKey: 'client:other', holderLabel: '端末B' })).rejects.toMatchObject({ statusCode: 409, code: ASSEMBLY_PROCEDURE_EDIT_LOCKED, details: { lease: { holderLabel: actor.holderLabel } } });
    expect(stored).toEqual(before);
  });

  it('allows another holder at the five-minute expiry boundary', async () => {
    await service.acquire(documentId, actor); vi.advanceTimersByTime(300_000);
    expect((await service.acquire(documentId, { holderKey: 'client:other', holderLabel: '端末B' })).lease).toMatchObject({ holderLabel: '端末B', acquiredAt: '2026-10-06T03:05:00.000Z' });
  });

  it('takes over explicitly and rejects the former holder heartbeat', async () => {
    await service.acquire(documentId, actor); vi.advanceTimersByTime(30_000);
    await service.acquire(documentId, { holderKey: 'client:other', holderLabel: '端末B' }, true);
    expect(stored?.holderKey).toBe('client:other');
    await expect(service.acquire(documentId, actor)).rejects.toMatchObject({ code: ASSEMBLY_PROCEDURE_EDIT_LOCKED });
    expect(stored?.holderKey).toBe('client:other');
  });

  it('releases only the requesting holder', async () => {
    await service.acquire(documentId, actor);
    await service.release(documentId, 'client:other'); expect(stored).not.toBeNull();
    await service.release(documentId, actor.holderKey, stored!.holderToken); expect(stored).toBeNull();
  });

  it('rejects writes held by another actor and preserves writes for owner, no lease and expired lease', async () => {
    await expect(service.assertCanWrite(documentId, null)).resolves.toBeUndefined();
    await service.acquire(documentId, actor);
    await expect(service.assertCanWrite(documentId, actor.holderKey, undefined, stored!.holderToken)).resolves.toBeUndefined();
    await expect(service.assertCanWrite(documentId, 'client:other')).rejects.toMatchObject({ code: ASSEMBLY_PROCEDURE_EDIT_LOCKED });
    vi.advanceTimersByTime(300_000);
    await expect(service.assertCanWrite(documentId, null)).resolves.toBeUndefined();
  });


  it('isolates sessions sharing a holder key and rotates the token on takeover', async () => {
    const first = await service.acquire(documentId, actor);
    await expect(service.acquire(documentId, actor)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.acquire(documentId, actor, false, 'other-session')).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.assertCanWrite(documentId, actor.holderKey)).rejects.toMatchObject({ statusCode: 409 });
    await service.release(documentId, actor.holderKey, 'other-session');
    expect(stored?.holderToken).toBe(first.holderToken);
    const next = await service.acquire(documentId, actor, true, first.holderToken);
    expect(next.holderToken).not.toBe(first.holderToken);
    await expect(service.acquire(documentId, actor, false, first.holderToken)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.assertCanWrite(documentId, actor.holderKey, undefined, first.holderToken)).rejects.toMatchObject({ statusCode: 409 });
    await service.release(documentId, actor.holderKey, first.holderToken);
    expect(stored?.holderToken).toBe(next.holderToken);
    await service.release(documentId, actor.holderKey);
    expect(stored).not.toBeNull();
    await service.release(documentId, actor.holderKey, next.holderToken);
    expect(stored).toBeNull();
  });

  it('returns not found before creating a lease for an unknown document', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    await expect(service.acquire(documentId, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.assemblyProcedureDocumentEditLease.upsert).not.toHaveBeenCalled();
  });
});
