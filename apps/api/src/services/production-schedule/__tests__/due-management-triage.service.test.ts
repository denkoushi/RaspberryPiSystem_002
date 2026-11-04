import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  listSummaries: vi.fn(),
  listDueDates: vi.fn()
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../row-resolver/index.js', () => ({ buildMaxProductNoWinnerCondition: () => Prisma.sql`TRUE` }));
vi.mock('../due-date-resolution.service.js', () => ({ listEarliestEffectiveDueDateBySeiban: mocks.listDueDates }));
vi.mock('../due-management-location-scope-adapter.service.js', () => ({
  toDueManagementScope: (scope: { deviceScopeKey?: string; siteKey?: string }) => ({
    deviceScopeKey: scope.deviceScopeKey ?? 'dev',
    siteKey: scope.siteKey ?? 'site'
  }),
  listDueManagementSummariesWithScope: mocks.listSummaries
}));

import { listDueManagementTriage } from '../due-management-triage.service.js';

type Summary = {
  fseiban: string;
  machineName: string | null;
  dueDate: Date | null;
  partsCount: number;
  processCount: number;
  totalRequiredMinutes: number;
  actualEstimatedMinutes: number;
  actualCoverageRatio: number;
};

const summary = (fseiban: string, overrides: Partial<Summary> = {}): Summary => ({
  fseiban,
  machineName: null,
  dueDate: null,
  partsCount: 1,
  processCount: 1,
  totalRequiredMinutes: 0,
  actualEstimatedMinutes: 0,
  actualCoverageRatio: 0,
  ...overrides
});

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('listDueManagementTriage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
    mocks.queryRaw.mockReset().mockResolvedValue([]);
    mocks.listSummaries.mockReset();
    mocks.listDueDates.mockReset().mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps only trimmed target seibans, marks selection and classifies by effective due date', async () => {
    mocks.listSummaries.mockResolvedValue([
      // summary dueDate is ignored: effective due date map is the source of truth
      summary('A', { dueDate: d('2030-01-01') }),
      summary('B'),
      summary('C'),
      summary('NOT-TARGET')
    ]);
    mocks.listDueDates.mockResolvedValue(
      new Map<string, Date | null>([
        ['A', d('2026-11-05')],
        ['B', d('2026-11-07')],
        ['C', d('2026-11-20')]
      ])
    );

    const result = await listDueManagementTriage({
      locationScope: { deviceScopeKey: 'kiosk-1' },
      targetFseibans: [' A ', 'B', 'C', '', '  '],
      selectedFseibans: [' B ']
    });

    expect(mocks.listSummaries).toHaveBeenCalledWith({ deviceScopeKey: 'kiosk-1', siteKey: 'site' });
    // effective due date lookup is requested for all summary rows (before target filtering)
    expect(mocks.listDueDates).toHaveBeenCalledWith(['A', 'B', 'C', 'NOT-TARGET']);

    expect(result.zones.danger.map((i) => i.fseiban)).toEqual(['A']);
    expect(result.zones.caution.map((i) => i.fseiban)).toEqual(['B']);
    expect(result.zones.safe.map((i) => i.fseiban)).toEqual(['C']);

    const [a] = result.zones.danger;
    expect(a.dueDate).toEqual(d('2026-11-05'));
    expect(a.daysUntilDue).toBe(1);
    expect(a.isSelected).toBe(false);
    expect(a.reasons.map((r) => r.code)).toEqual(['DUE_DATE_TOMORROW']);

    const [b] = result.zones.caution;
    expect(b.daysUntilDue).toBe(3);
    expect(b.isSelected).toBe(true);
    expect(b.reasons.map((r) => r.code)).toEqual(['DUE_DATE_SOON']);
  });

  it('treats seibans without an effective due date as caution with DUE_DATE_MISSING', async () => {
    mocks.listSummaries.mockResolvedValue([summary('X', { dueDate: d('2026-11-04') })]);
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['X'],
      selectedFseibans: []
    });
    expect(result.zones.caution).toHaveLength(1);
    const [x] = result.zones.caution;
    expect(x.dueDate).toBeNull();
    expect(x.daysUntilDue).toBeNull();
    expect(x.reasons).toEqual([{ code: 'DUE_DATE_MISSING', message: '納期日が未設定です' }]);
  });

  it('skips the processing-type query when no target matches and returns empty zones', async () => {
    mocks.listSummaries.mockResolvedValue([summary('A')]);
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['Z'],
      selectedFseibans: ['A']
    });
    expect(result).toEqual({ zones: { danger: [], caution: [], safe: [] } });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('applies the top processing type to reasons and passes the filtered seibans to SQL', async () => {
    mocks.listSummaries.mockResolvedValue([summary('A'), summary('B')]);
    mocks.listDueDates.mockResolvedValue(new Map([['A', d('2026-12-31')], ['B', d('2026-12-31')]]));
    mocks.queryRaw.mockResolvedValue([
      { fseiban: 'A', processingType: 'カニゼン' },
      { fseiban: 'B', processingType: null }
    ]);
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['A', 'B'],
      selectedFseibans: []
    });
    const sqlValues = mocks.queryRaw.mock.calls[0].slice(1);
    expect(sqlValues).toContainEqual(expect.objectContaining({ values: ['A', 'B'] }));
    const byId = new Map(result.zones.safe.map((i) => [i.fseiban, i]));
    expect(byId.get('A')?.topProcessingType).toBe('カニゼン');
    expect(byId.get('A')?.reasons.map((r) => r.code)).toEqual(['SURFACE_PRIORITY']);
    expect(byId.get('B')?.topProcessingType).toBeNull();
    expect(byId.get('B')?.reasons).toEqual([]);
  });

  it('sorts within a zone by due date asc, then process count desc, then processing priority, then fseiban', async () => {
    mocks.listSummaries.mockResolvedValue([
      summary('S-late', { processCount: 1 }),
      summary('S-z', { processCount: 5 }),
      summary('S-a', { processCount: 5 }),
      summary('S-more', { processCount: 9 }),
      summary('S-paint', { processCount: 5 }),
      summary('S-lslh', { processCount: 5 })
    ]);
    mocks.listDueDates.mockResolvedValue(
      new Map([
        ['S-late', d('2026-12-20')],
        ['S-z', d('2026-12-10')],
        ['S-a', d('2026-12-10')],
        ['S-more', d('2026-12-10')],
        ['S-paint', d('2026-12-10')],
        ['S-lslh', d('2026-12-10')]
      ])
    );
    mocks.queryRaw.mockResolvedValue([
      { fseiban: 'S-paint', processingType: '塗装' },
      { fseiban: 'S-lslh', processingType: 'LSLH' }
    ]);
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['S-late', 'S-z', 'S-a', 'S-more', 'S-paint', 'S-lslh'],
      selectedFseibans: []
    });
    expect(result.zones.safe.map((i) => i.fseiban)).toEqual(['S-more', 'S-lslh', 'S-paint', 'S-a', 'S-z', 'S-late']);
  });

  it('places items without due date after dated items within the same zone', async () => {
    // both caution: one due in 2 days, one without due date
    mocks.listSummaries.mockResolvedValue([summary('NODUE', { processCount: 99 }), summary('DATED', { processCount: 1 })]);
    mocks.listDueDates.mockResolvedValue(new Map([['DATED', d('2026-11-06')]]));
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['NODUE', 'DATED'],
      selectedFseibans: []
    });
    // NODUE has processCount 99 >= 40 so it escalates to danger; DATED remains caution
    expect(result.zones.danger.map((i) => i.fseiban)).toEqual(['NODUE']);
    expect(result.zones.caution.map((i) => i.fseiban)).toEqual(['DATED']);

    mocks.listSummaries.mockResolvedValue([summary('NODUE', { processCount: 2 }), summary('DATED', { processCount: 1 })]);
    const second = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['NODUE', 'DATED'],
      selectedFseibans: []
    });
    expect(second.zones.caution.map((i) => i.fseiban)).toEqual(['DATED', 'NODUE']);
  });

  it('computes daysUntilDue by UTC calendar day (overdue becomes negative)', async () => {
    mocks.listSummaries.mockResolvedValue([summary('OVER'), summary('TODAY')]);
    mocks.listDueDates.mockResolvedValue(
      new Map([
        ['OVER', d('2026-11-01')],
        ['TODAY', new Date('2026-11-04T23:59:59.000Z')]
      ])
    );
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['OVER', 'TODAY'],
      selectedFseibans: []
    });
    const byId = new Map(result.zones.danger.map((i) => [i.fseiban, i]));
    expect(byId.get('OVER')?.daysUntilDue).toBe(-3);
    expect(byId.get('OVER')?.reasons.map((r) => r.code)).toEqual(['DUE_DATE_OVERDUE']);
    expect(byId.get('TODAY')?.daysUntilDue).toBe(0);
    expect(byId.get('TODAY')?.reasons.map((r) => r.code)).toEqual(['DUE_DATE_TODAY']);
  });

  it('uses UTC (not JST) day boundary in the JST early morning', async () => {
    // 2026-11-05 08:00 JST == 2026-11-04 23:00 UTC
    vi.setSystemTime(new Date('2026-11-04T23:00:00.000Z'));
    mocks.listSummaries.mockResolvedValue([summary('DUE-JST-TODAY')]);
    mocks.listDueDates.mockResolvedValue(new Map([['DUE-JST-TODAY', d('2026-11-05')]]));
    const result = await listDueManagementTriage({
      locationScope: {},
      targetFseibans: ['DUE-JST-TODAY'],
      selectedFseibans: []
    });
    const [item] = result.zones.danger;
    // NOTE: possible bug: in JST this item is due "today" (2026-11-05), but the service
    // computes daysUntilDue from the UTC date (2026-11-04) and reports "tomorrow" between 00:00-09:00 JST.
    expect(item.daysUntilDue).toBe(1);
    expect(item.reasons.map((r) => r.code)).toEqual(['DUE_DATE_TOMORROW']);
  });
});
