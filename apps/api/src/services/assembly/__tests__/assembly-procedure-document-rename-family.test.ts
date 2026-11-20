import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    assemblyProcedureDocumentEditLease: { findUnique: vi.fn() },
    assemblyProcedureDocument: { update: vi.fn() }
  }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.db }));

import { ASSEMBLY_PROCEDURE_EDIT_LOCKED } from '../assembly-procedure-document-edit-lease.service.js';
import { AssemblyProcedureDocumentService } from '../assembly-procedure-document.service.js';

const holder = { holderKey: 'user:operator', holderToken: 'session' };
const otherLease = { documentId: 'draft', holderKey: 'user:other', holderToken: 'x', holderLabel: '別の人', acquiredAt: new Date(), heartbeatAt: new Date(), expiresAt: new Date(Date.now() + 300_000) };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db));
  mocks.db.$queryRaw.mockResolvedValue([{ id: 'draft' }, { id: 'published' }]);
  mocks.db.assemblyProcedureDocumentEditLease.findUnique.mockResolvedValue(null);
  mocks.db.assemblyProcedureDocument.update.mockImplementation(async ({ where, data }) => ({ id: where.id, name: data.name }));
});

describe('AssemblyProcedureDocumentService.rename revision family', () => {
  it('renames the published document and its revision draft together under a row lock', async () => {
    const result = await new AssemblyProcedureDocumentService().rename('published', ' 新名称 ', holder);
    expect(mocks.db.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(mocks.db.assemblyProcedureDocument.update.mock.calls.map(([arg]) => [arg.where.id, arg.data.name]))
      .toEqual([['draft', '新名称'], ['published', '新名称']]);
    expect(result).toMatchObject({ id: 'published', name: '新名称' });
  });

  it('rejects the rename without writing when another holder has a lease on the revision draft', async () => {
    mocks.db.assemblyProcedureDocumentEditLease.findUnique.mockImplementation(async ({ where }) => where.documentId === 'draft' ? otherLease : null);
    await expect(new AssemblyProcedureDocumentService().rename('published', '新名称', holder))
      .rejects.toMatchObject({ statusCode: 409, code: ASSEMBLY_PROCEDURE_EDIT_LOCKED });
    expect(mocks.db.assemblyProcedureDocument.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the target is not in the locked family', async () => {
    mocks.db.$queryRaw.mockResolvedValue([]);
    await expect(new AssemblyProcedureDocumentService().rename('missing', '名前', holder)).rejects.toMatchObject({ statusCode: 404 });
  });
});
