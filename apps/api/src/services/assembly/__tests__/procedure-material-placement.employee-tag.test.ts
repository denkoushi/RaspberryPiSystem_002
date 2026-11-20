import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    employee: { findFirst: vi.fn(), findMany: vi.fn() },
    procedureMaterial: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    assemblyProcedureDocumentPage: { findUnique: vi.fn() },
    assemblyProcedureOverlayElement: { aggregate: vi.fn() },
  },
}));
vi.mock('../assembly-transaction.js', () => ({ runAssemblyTransaction: (work: (tx: unknown) => unknown) => work(mocks.tx) }));
vi.mock('../assembly-procedure-document-edit-lease.service.js', () => ({ AssemblyProcedureDocumentEditLeaseService: class { assertCanWrite = vi.fn(); } }));
import { ProcedureMaterialPlacementService } from '../procedure-material-placement.service.js';
import { ProcedureMaterialService } from '../procedure-material.service.js';

const material = { id: 'material', origin: 'APP', kind: 'TEXT', text: '手順', appRef: { nameId: '007125' },
  gmailMessageId: 'submission', documentId: null, placedAt: null, discardedAt: null };
const employee = { id: 'employee', employeeCode: '7125', displayName: '津田', nfcTagUid: 'mine', status: 'ACTIVE' };
const params = { documentId: 'document', materialId: 'material', pageIndex: 0 };
const service = () => new ProcedureMaterialPlacementService({} as never, {} as never, { requireAccessPassword: vi.fn() } as never);
const shelf = () => new ProcedureMaterialService(mocks.tx as never, {} as never, {} as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([{ id: 'document', status: 'DRAFT', isActive: true, revisionRootId: 'root', isRevisionHead: true }]);
  mocks.tx.procedureMaterial.findUnique.mockResolvedValue(material);
  mocks.tx.employee.findFirst.mockResolvedValue(employee);
  mocks.tx.employee.findMany.mockResolvedValue([employee]);
  mocks.tx.assemblyProcedureDocumentPage.findUnique.mockResolvedValue({ pageIndex: 0 });
  mocks.tx.assemblyProcedureOverlayElement.aggregate.mockResolvedValue({ _max: { zIndex: null } });
  mocks.tx.procedureMaterial.updateMany.mockResolvedValue({ count: 1 });
});
describe('employee material placement', () => {
  it.each([
    [undefined, employee], ['other', { ...employee, employeeCode: '1234' }], ['missing', null], ['inactive', { ...employee, status: 'INACTIVE' }],
  ])('rejects tag %s with 403 before writing', async (employeeTagUid, resolved) => {
    mocks.tx.employee.findFirst.mockResolvedValue(resolved);
    await expect(service().place({ ...params, employeeTagUid })).rejects.toMatchObject({ statusCode: 403, code: 'EMPLOYEE_TAG_MISMATCH' });
    expect(mocks.tx.procedureMaterial.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it.each(['007125', 7125])('allows the owner for nameId %s after locking the material', async nameId => {
    mocks.tx.procedureMaterial.findUnique.mockResolvedValue({ ...material, appRef: { nameId } });
    await expect(service().place({ ...params, employeeTagUid: 'mine' })).resolves.toMatchObject({ element: { kind: 'TEXT', text: '手順' } });
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(mocks.tx.employee.findFirst.mock.invocationCallOrder[0]);
    expect(mocks.tx.procedureMaterial.updateMany).toHaveBeenCalledOnce();
  });
  it('places only the memo as TEXT and removes it from the next employee list', async () => {
    const note = { ...material };
    const photo = { ...material, id: 'photo', kind: 'PHOTO', text: null };
    mocks.tx.procedureMaterial.findUnique.mockResolvedValue(note);
    mocks.tx.procedureMaterial.findMany.mockImplementation(async ({ where }) =>
      [photo, note].filter(row => row.documentId === where.documentId && row.placedAt === where.placedAt));
    mocks.tx.procedureMaterial.updateMany.mockImplementationOnce(async ({ where, data }) => {
      expect(where).toEqual({ id: note.id, discardedAt: null });
      Object.assign(note, data);
      return { count: 1 };
    });

    expect((await shelf().listByEmployeeTag('mine')).materials.map(row => row.id)).toEqual([note.id, photo.id]);
    await expect(service().place({ ...params, employeeTagUid: 'mine' })).resolves.toMatchObject({
      element: { kind: 'TEXT', text: note.text },
    });
    expect((await shelf().listByEmployeeTag('mine')).materials.map(row => row.id)).toEqual([photo.id]);
  });
  it.each([
    { ...material, origin: 'GMAIL' }, { ...material, appRef: null }, { ...material, appRef: { nameId: '' } },
  ])('allows materials without an employee number without a tag: %s', async row => {
    mocks.tx.procedureMaterial.findUnique.mockResolvedValue(row);
    await expect(service().place(params)).resolves.toMatchObject({ element: { kind: 'TEXT' } });
    expect(mocks.tx.employee.findFirst).not.toHaveBeenCalled();
  });
  it.each(['unknown', '  '])('rejects nonempty invalid nameId %s even with an active tag', async nameId => {
    mocks.tx.procedureMaterial.findUnique.mockResolvedValue({ ...material, appRef: { nameId } });
    await expect(service().place({ ...params, employeeTagUid: 'mine' })).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.tx.procedureMaterial.updateMany).not.toHaveBeenCalled();
  });
});

describe('employee material list', () => {
  it('inserts each owned memo before the first photo without reordering photos, before applying the limit', async () => {
    const submissionA = { ...material, gmailMessageId: 'a' };
    const submissionB = { ...material, gmailMessageId: 'b' };
    const rows = [
      { ...submissionB, id: 'note-b' },
      { ...submissionA, id: 'photo-a1', kind: 'PHOTO' },
      { ...submissionB, id: 'photo-b', kind: 'PHOTO' },
      { ...submissionA, id: 'photo-a2', kind: 'PHOTO' },
      { ...submissionA, id: 'note-a' },
      { ...material, id: 'other-note', appRef: { nameId: '1234' } },
      { ...material, id: 'other-photo', kind: 'PHOTO', appRef: { nameId: '1234' } },
    ];
    mocks.tx.procedureMaterial.findMany.mockResolvedValue(rows);
    expect((await shelf().listByEmployeeTag('mine')).materials.map(row => row.id))
      .toEqual(['note-a', 'photo-a1', 'note-b', 'photo-b', 'photo-a2']);
    expect((await shelf().listByEmployeeTag('mine', 1)).materials.map(row => row.id)).toEqual(['photo-a1']);
    expect((await shelf().listByEmployeeTag('mine', 3)).materials.map(row => row.id)).toEqual(['note-a', 'photo-a1', 'photo-b']);
  });

  it('does not create a memo even when the tag and the photo have the same nonnumeric employee number', async () => {
    mocks.tx.employee.findFirst.mockResolvedValue({ ...employee, employeeCode: '7125A' });
    mocks.tx.procedureMaterial.findMany.mockResolvedValue([
      { ...material, kind: 'PHOTO', appRef: { nameId: '7125A', note: '手順' } },
    ]);

    expect((await shelf().listByEmployeeTag('mine')).materials).toEqual([]);
    expect(mocks.tx.procedureMaterial.createMany).not.toHaveBeenCalled();
  });

  it('keeps a photo-free memo at its received position, including at the list limit', async () => {
    const newer = { ...material, gmailMessageId: 'newer', receivedAt: new Date('2026-11-19T06:00:00Z') };
    const older = { ...material, gmailMessageId: 'older', receivedAt: new Date('2026-11-19T04:00:00Z') };
    const memoOnly = {
      ...material, id: 'memo-only', gmailMessageId: 'no-photos', receivedAt: new Date('2026-11-19T05:00:00Z'),
      appRef: { ...material.appRef, hasPhotos: false, photoIndex: 0 },
    };
    mocks.tx.procedureMaterial.findMany.mockResolvedValue([
      { ...newer, id: 'newer-note' }, { ...newer, id: 'newer-photo', kind: 'PHOTO' },
      memoOnly,
      { ...older, id: 'older-photo', kind: 'PHOTO' }, { ...older, id: 'older-note' },
    ]);

    expect((await shelf().listByEmployeeTag('mine')).materials.map(row => row.id))
      .toEqual(['newer-note', 'newer-photo', 'memo-only', 'older-note', 'older-photo']);
    expect((await shelf().listByEmployeeTag('mine', 3)).materials.map(row => row.id))
      .toEqual(['newer-note', 'newer-photo', 'memo-only']);
    expect((await shelf().listByEmployeeTag('mine', 4)).materials.map(row => row.id))
      .toEqual(['newer-note', 'newer-photo', 'memo-only', 'older-photo']);
  });

  it('hides a memo after all photos are discarded and keeps a memo after all photos are placed', async () => {
    const placed = { ...material, id: 'placed-note', gmailMessageId: 'placed-submission' };
    const discarded = { ...material, id: 'discarded-note', gmailMessageId: 'discarded-submission' };
    mocks.tx.procedureMaterial.findMany.mockResolvedValueOnce([discarded, placed])
      .mockResolvedValueOnce([{ gmailMessageId: placed.gmailMessageId }]);
    expect((await shelf().listByEmployeeTag('mine', 1)).materials.map(row => row.id)).toEqual([placed.id]);
    expect(mocks.tx.procedureMaterial.findMany).toHaveBeenNthCalledWith(2, {
      where: { origin: 'APP', kind: 'PHOTO', discardedAt: null, gmailMessageId: { in: [discarded.gmailMessageId, placed.gmailMessageId] } },
      select: { gmailMessageId: true }, distinct: ['gmailMessageId'],
    });
  });
});

describe('developer employee number 9999', () => {
  const developer = { ...employee, employeeCode: '9999', nfcTagUid: 'developer' };
  const developerMaterial = { ...material, appRef: { nameId: '9999' } };

  it.each(['ACTIVE', 'INACTIVE', 'SUSPENDED'])('lists and places every employee-numbered material with a %s 9999 tag', async status => {
    mocks.tx.employee.findFirst.mockResolvedValue({ ...developer, status });
    const others = [{ ...material, id: 'other', gmailMessageId: 'other', appRef: { nameId: '1234' } },
      { ...material, id: 'odd', gmailMessageId: 'odd', appRef: { nameId: '津田' } }];
    const unnumbered = { ...material, id: 'unnumbered', gmailMessageId: 'unnumbered', appRef: {} };
    mocks.tx.procedureMaterial.findMany.mockResolvedValue([developerMaterial, ...others, unnumbered]);

    const listed = await shelf().listByEmployeeTag('developer');
    expect(listed).toMatchObject({ employee: { employeeCode: '9999' } });
    expect(listed.materials.map(item => item.id).sort()).toEqual(['material', 'odd', 'other']);
    for (const target of [developerMaterial, ...others]) {
      mocks.tx.procedureMaterial.findUnique.mockResolvedValue(target);
      await expect(service().place({ ...params, materialId: target.id, employeeTagUid: 'developer' })).resolves.toMatchObject({ element: { kind: 'TEXT' } });
    }
  });

  it.each(['INACTIVE', 'SUSPENDED'])('still stops a %s non-9999 tag on list and place', async status => {
    mocks.tx.employee.findFirst.mockResolvedValue({ ...employee, status });
    await expect(shelf().listByEmployeeTag('mine')).rejects.toMatchObject({ statusCode: 404, code: 'EMPLOYEE_TAG_NOT_FOUND' });
    await expect(service().place({ ...params, employeeTagUid: 'mine' })).rejects.toMatchObject({ statusCode: 403, code: 'EMPLOYEE_TAG_MISMATCH' });
    expect(mocks.tx.procedureMaterial.updateMany).not.toHaveBeenCalled();
  });

  it('keeps other tags to their own number', async () => {
    mocks.tx.procedureMaterial.findMany.mockResolvedValue([material, developerMaterial, { ...material, id: 'other', gmailMessageId: 'other', appRef: { nameId: '1234' } }]);
    expect((await shelf().listByEmployeeTag('mine')).materials.map(item => item.id)).toEqual(['material']);
  });

  it('does not let another tag place 9999 materials, and an unknown tag stays 404', async () => {
    mocks.tx.procedureMaterial.findUnique.mockResolvedValue(developerMaterial);
    await expect(service().place({ ...params, employeeTagUid: 'mine' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service().place(params)).rejects.toMatchObject({ statusCode: 403 });
    mocks.tx.employee.findFirst.mockResolvedValue(null);
    await expect(shelf().listByEmployeeTag('unknown')).rejects.toMatchObject({ statusCode: 404 });
  });
});
