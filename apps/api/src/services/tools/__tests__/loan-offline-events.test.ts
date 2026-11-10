import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { loanEventFingerprint, resolveLoanReadAt, runLoanEvent } from '../../loan/loan-event.js';
import { MeasuringInstrumentLoanService } from '../../measuring-instruments/loan.service.js';
import { RiggingLoanService } from '../../rigging/loan.service.js';
import { LoanService } from '../loan.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  loan: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  transaction: { findFirst: vi.fn(), create: vi.fn() },
  item: { update: vi.fn() }, measuringInstrument: { update: vi.fn() }, riggingGear: { update: vi.fn() },
  inspectionItem: { count: vi.fn() }, inspectionRecord: { createMany: vi.fn() },
  $transaction: vi.fn(),
} }));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../camera/index.js', () => ({ CameraService: class {} }));
vi.mock('../photo-tool-label/photo-tool-label.scheduler.js', () => ({ getPhotoToolLabelScheduler: vi.fn() }));
vi.mock('../item.service.js', () => ({ ItemService: class {
  findByNfcTagUid = vi.fn(async () => ({ id: 'asset', itemCode: 'TOOL', name: '工具', status: 'AVAILABLE' }));
} }));
vi.mock('../employee.service.js', () => ({ EmployeeService: class {
  findByNfcTagUid = vi.fn(async () => ({ id: 'employee', employeeCode: 'EMP', displayName: '社員' }));
} }));
vi.mock('../../measuring-instruments/measuring-instrument.service.js', () => ({ MeasuringInstrumentService: class {
  findByTagUid = vi.fn(async () => ({ id: 'asset', genreId: 'genre', managementNumber: 'MI', name: '計測', status: 'AVAILABLE' }));
} }));
vi.mock('../../rigging/rigging-gear.service.js', () => ({ RiggingGearService: class {
  findByTagUid = vi.fn(async () => ({ id: 'asset', managementNumber: 'RG', name: '吊具', status: 'AVAILABLE' }));
} }));
vi.mock('../../measuring-instruments/measuring-instrument-loan-event.service.js', () => ({ MeasuringInstrumentLoanEventService: class {
  recordNfcEvent = vi.fn();
} }));
vi.mock('../../rigging/inspection/rigging-borrow-inspection.orchestrator.js', () => ({ RiggingBorrowInspectionOrchestrator: class {
  recordIfNotDuplicate = vi.fn();
} }));

const now = new Date('2026-11-03T12:00:00Z');
const readAt = new Date('2026-11-03T09:00:00Z');
const eventKey = '11111111-1111-4111-8111-111111111111';
type SavedLoan = Record<string, unknown> & { id: string };
let saved: SavedLoan | undefined;
let returnedEvent: Record<string, unknown> | undefined;
let events: Map<string, Record<string, unknown>>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  saved = undefined;
  returnedEvent = undefined;
  events = new Map();
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => (fn as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
  vi.mocked(prisma.loan.findFirst).mockImplementation(async ({ where }: never) => (
    where.eventKey ? (saved?.eventKey === where.eventKey && saved?.clientId === where.clientId ? saved : null)
      : saved && !saved.returnedAt ? saved : null
  ) as never);
  vi.mocked(prisma.loan.create).mockImplementation(async ({ data }: never) => {
    saved = { ...data, id: 'loan', item: { id: 'asset', itemCode: 'TOOL', name: '工具' }, employee: { id: 'employee', employeeCode: 'EMP', displayName: '社員' } };
    return saved as never;
  });
  vi.mocked(prisma.loan.findUnique).mockImplementation(async () => (saved ?? null) as never);
  vi.mocked(prisma.loan.findUniqueOrThrow).mockImplementation(async () => saved as never);
  vi.mocked(prisma.loan.updateMany).mockImplementation(async ({ data }: never) => {
    if (saved?.returnedAt) return { count: 0 };
    Object.assign(saved!, data);
    return { count: 1 };
  });
  vi.mocked(prisma.transaction.create).mockImplementation(async ({ data }: never) => {
    if (data.eventKey) {
      events.set(`${data.clientId}:${data.eventKey}`, data);
      if (data.action === 'RETURN') returnedEvent = data;
    }
    return { id: 'transaction', ...data } as never;
  });
  vi.mocked(prisma.transaction.findFirst).mockImplementation(async ({ where }: never) => {
    const event = events.get(`${where.clientId}:${where.eventKey}`);
    return event ? { ...event, loan: saved } as never : null;
  });
  vi.mocked(prisma.inspectionItem.count).mockResolvedValue(1);
});
afterEach(() => vi.useRealTimers());

const cases = [
  { kind: 'tool', borrow: (body: object) => new LoanService().borrow({ itemTagUid: 'TOOL', employeeTagUid: 'EMPLOYEE', ...body }, 'client'),
    return: (body: object) => new LoanService().return({ loanId: 'loan', ...body }, 'client') },
  { kind: 'instrument', borrow: (body: object) => new MeasuringInstrumentLoanService().borrow({ instrumentTagUid: 'MI', employeeTagUid: 'EMPLOYEE', clientId: 'client', ...body }),
    return: (body: object) => new MeasuringInstrumentLoanService().return({ loanId: 'loan', clientId: 'client', ...body }) },
  { kind: 'rigging', borrow: (body: object) => new RiggingLoanService().borrow({ riggingTagUid: 'RG', employeeTagUid: 'EMPLOYEE', clientId: 'client', ...body }),
    return: (body: object) => new RiggingLoanService().return({ loanId: 'loan', clientId: 'client', ...body }) },
];

describe.each(cases)('$kind offline loan events', api => {
  it('returns the original loan for the same borrow eventKey before active-asset validation', async () => {
    const first = await api.borrow({ eventKey, readAt });
    expect(await api.borrow({ eventKey, readAt })).toBe(first);
    expect(prisma.loan.create).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ borrowedAt: readAt, borrowReceivedAt: now });
  });
  it('retains borrow identity after another kiosk returns the loan', async () => {
    const first = await api.borrow({ eventKey, readAt });
    saved!.clientId = 'other-kiosk';
    saved!.returnedAt = now;
    expect(await api.borrow({ eventKey, readAt })).toBe(first);
    expect(prisma.loan.create).toHaveBeenCalledTimes(1);
  });
  it('rejects a reused key with a different fingerprint', async () => {
    await api.borrow({ eventKey, readAt });
    await expect(api.borrow({ eventKey, readAt, note: 'different' })).rejects.toMatchObject({ statusCode: 409, code: 'EVENT_KEY_REUSED' });
  });
  it('records readAt and reception time on return and acknowledges duplicate returns', async () => {
    await api.borrow({ readAt });
    const returnedAt = new Date('2026-11-03T10:00:00Z');
    await api.return({ eventKey, readAt: returnedAt });
    expect(saved).toMatchObject({ returnedAt, returnReceivedAt: now });
    await api.return({ eventKey, readAt: returnedAt });
    expect(prisma.loan.updateMany).toHaveBeenCalledTimes(1);
    expect(returnedEvent).toMatchObject({ eventKey, clientId: 'client' });
    await expect(api.return({ eventKey, readAt: returnedAt, note: 'different' })).rejects.toMatchObject({ code: 'EVENT_KEY_REUSED' });
  });
  it('clamps readAt before borrowedAt to borrowedAt and warns', async () => {
    await api.borrow({ readAt });
    await api.return({ eventKey, readAt: new Date(readAt.getTime() - 60_000) });
    expect(saved).toMatchObject({ returnedAt: readAt, returnReceivedAt: now });
    expect(prisma.loan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ returnedAt: readAt }),
    }));
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      { loanId: 'loan', eventAt: new Date(readAt.getTime() - 60_000), borrowedAt: readAt },
      'Return time clamped to borrow time',
    );
  });
  it('keeps the legacy already-returned response without an eventKey', async () => {
    await api.borrow({});
    await api.return({});
    await expect(api.return({})).rejects.toMatchObject({ statusCode: 409, code: 'LOAN_ALREADY_RETURNED' });
  });
  it('corrects out-of-range readAt for both borrow and return', async () => {
    await api.borrow({ readAt: new Date('2026-11-03T12:05:00Z') });
    expect(saved).toMatchObject({ borrowedAt: now, borrowReceivedAt: now });
    await api.return({ readAt: new Date('2026-10-01T00:00:00Z') });
    expect(saved).toMatchObject({ returnedAt: now, returnReceivedAt: now });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe('loan event boundaries', () => {
  it.each([
    [undefined, false], [new Date(now.getTime() + 299_999), false],
    [new Date(now.getTime() + 300_000), true],
    [new Date(now.getTime() - 7 * 86400_000), false],
    [new Date(now.getTime() - 7 * 86400_000 - 1), true],
  ])('adopts or corrects %s (corrected=%s)', (value, corrected) => {
    const result = resolveLoanReadAt(value, now);
    expect(result).toEqual({ eventAt: corrected || !value ? now : value, receivedAt: now });
    expect(logger.warn).toHaveBeenCalledTimes(corrected ? 1 : 0);
  });
  it.each([
    new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    new ApiError(409, 'conflict'),
  ])('recovers the concurrent winner after transaction conflict', async conflict => {
    const input = { eventKey, readAt };
    const winner = { id: 'winner', eventFingerprint: loanEventFingerprint(input, 'tool.borrow') };
    vi.mocked(prisma.transaction.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...winner, loan: winner } as never);
    const execute = vi.fn().mockRejectedValue(conflict);
    expect(await runLoanEvent(input, 'client', 'tool.borrow', execute)).toBe(winner);
  });
  it('requires a client for keyed requests', async () => {
    const execute = vi.fn();
    await expect(runLoanEvent({ eventKey }, undefined, 'tool.borrow', execute)).rejects.toMatchObject({ statusCode: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
  it('saves known inspection results atomically with an instrument loan, once', async () => {
    const api = cases[1];
    await api.borrow({ eventKey, readAt, inspectionItemIds: ['inspection'] });
    await api.borrow({ eventKey, readAt, inspectionItemIds: ['inspection'] });
    expect(prisma.inspectionRecord.createMany).toHaveBeenCalledExactlyOnceWith({ data: [{
      measuringInstrumentId: 'asset', loanId: 'loan', employeeId: 'employee', inspectionItemId: 'inspection', result: 'PASS', inspectedAt: readAt,
    }] });
  });
});
