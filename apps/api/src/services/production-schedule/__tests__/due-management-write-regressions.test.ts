import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn(), findNotes: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $queryRaw: mocks.query, $transaction: mocks.transaction,
  productionScheduleRowNote: { findMany: mocks.findNotes }
} }));
vi.mock('../../part-measurement/self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches: vi.fn()
}));
vi.mock('../production-schedule-command.service.js', () => ({
  upsertProductionSchedulePartProcessingTypeByFhincd: vi.fn()
}));

vi.mock('@prisma/client', () => ({ Prisma: {
  TransactionIsolationLevel: { Serializable: 'Serializable' },
  PrismaClientKnownRequestError: class extends Error {}
} }));
vi.mock('../row-resolver/index.js', () => ({ buildMaxProductNoWinnerCondition: vi.fn() }));
vi.mock('../grinding-planning-board-projection.js', () => ({}));
vi.mock('../policies/resource-category-policy.service.js', () => ({}));
vi.mock('../due-management-location-scope-adapter.service.js', () => ({}));
vi.mock('../due-management-detail-presentation.service.js', () => ({}));
vi.mock('../leaderboard/leaderboard-shell-snapshot-generation.js', () => ({}));
vi.mock('../sessaku-pieces/piece-key.js', () => ({}));

import {
  upsertProductionScheduleSeibanDueDate,
  upsertProductionScheduleSeibanProcessingDueDate
} from '../due-management-command.service.js';
import { isValidDueDateText } from '../due-date-writeback.service.js';
import { resolvePlanningBoardDueRequest } from '../grinding-planning-board/shared.js';
import { updateGrindingPlanningBoardDueScope } from '../grinding-planning-board-due-scope.service.js';

beforeEach(() => vi.resetAllMocks());
const part = { locationKey: 'site', fseiban: 'S1', fhincd: 'P1' };

describe('calendar date validation', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', 'bad'])('rejects %s', (date) => {
    expect(isValidDueDateText(date)).toBe(false);
  });
  it.each(['', '  ', '2028-02-29', ' 2026-02-28 ', '2026-12-31'])('accepts %j', (date) => {
    expect(isValidDueDateText(date)).toBe(true);
  });
  it.each(['seiban', 'processing', 'scope'])('returns existing 400 message for %s writes', async (kind) => {
    mocks.transaction.mockResolvedValue({});
    const dueDateText = '2026-02-30';
    const promise = kind === 'seiban'
      ? upsertProductionScheduleSeibanDueDate({ ...part, dueDateText })
      : kind === 'processing'
        ? upsertProductionScheduleSeibanProcessingDueDate({ ...part, processingType: '研削', dueDateText })
        : updateGrindingPlanningBoardDueScope({ siteKey: 'site', fseiban: 'S1', request: {
          scope: { kind: 'seiban' }, dueDate: dueDateText
        } as never });
    await expect(promise).rejects.toMatchObject({ statusCode: 400, message: '納期日はYYYY-MM-DD形式で入力してください' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

const offset = (days: number, base = '2026-01-01') => resolvePlanningBoardDueRequest({
  request: { kind: 'offsetDays', days }, currentEffectiveDueDate: base, originalDueDate: null
});
describe('due offset bounds', () => {
  it.each([3651, Number.MAX_SAFE_INTEGER, 0, -1, 1.5])('rejects %s with INVALID_DUE_OFFSET', (days) => {
    expect(() => offset(days)).toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_DUE_OFFSET' }));
  });
  it.each([1, 3650])('accepts %s days', (days) => {
    expect(offset(days)?.getTime()).toBe(new Date('2026-01-01Z').getTime() + days * 86400000);
  });
  it.each(['invalid', '+275760-09-13'])('rejects an invalid date after addition from %s', (base) => {
    expect(() => offset(1, base)).toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_DUE_OFFSET' }));
  });
});
