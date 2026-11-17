import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    employee: { findFirst: vi.fn() },
    procedureMaterial: { findUnique: vi.fn(), updateMany: vi.fn() },
    assemblyProcedureDocumentPage: { findUnique: vi.fn() },
    assemblyProcedureOverlayElement: { aggregate: vi.fn() },
  },
}));
vi.mock('../assembly-transaction.js', () => ({ runAssemblyTransaction: (work: (tx: unknown) => unknown) => work(mocks.tx) }));
vi.mock('../assembly-procedure-document-edit-lease.service.js', () => ({ AssemblyProcedureDocumentEditLeaseService: class { assertCanWrite = vi.fn(); } }));
import { ProcedureMaterialPlacementService } from '../procedure-material-placement.service.js';

const material = { id: 'material', origin: 'APP', kind: 'TEXT', text: '手順', appRef: { nameId: '007125' }, discardedAt: null };
const employee = { id: 'employee', employeeCode: '7125', displayName: '津田', nfcTagUid: 'mine', status: 'ACTIVE' };
const params = { documentId: 'document', materialId: 'material', pageIndex: 0 };
const service = () => new ProcedureMaterialPlacementService({} as never, {} as never, { requireAccessPassword: vi.fn() } as never);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([{ id: 'document', status: 'DRAFT', isActive: true, revisionRootId: 'root', isRevisionHead: true }]);
  mocks.tx.procedureMaterial.findUnique.mockResolvedValue(material);
  mocks.tx.employee.findFirst.mockResolvedValue(employee);
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
