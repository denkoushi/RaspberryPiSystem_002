import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generation: vi.fn(), revision: vi.fn(), winners: vi.fn(), query: vi.fn(), names: vi.fn(), base: vi.fn(), monthly: vi.fn(), classes: vi.fn(), calendars: vi.fn(), rules: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { productionScheduleSeibanMachineNameSupplement: { aggregate: mocks.revision } } }));
vi.mock('../../../../lib/site-directory.js', () => ({ resolveSiteKeyForScopeKey: (key: string) => key }));
vi.mock('../../leaderboard/leaderboard-shell-snapshot-generation.js', () => ({ readGrindingPlanningBoardSnapshotGenerationToken: mocks.generation }));
vi.mock('../../seiban-machine-display-names.service.js', () => ({ resolveSeibanMachineDisplayNamesForWinnerRows: mocks.names }));
vi.mock('../load-balancing-winner-row-ids.js', () => ({ fetchLoadBalancingWinnerRowIds: mocks.winners }));
vi.mock('../start-date-leveling-query.service.js', () => ({ listStartDateLevelingQueryRows: mocks.query }));
vi.mock('../load-balancing-settings.service.js', () => ({
  listLoadBalancingCapacityBaseResolved: mocks.base, listLoadBalancingMonthlyCapacityRangeResolved: mocks.monthly,
  listLoadBalancingClassesResolved: mocks.classes, listLoadBalancingWorkCalendarsResolved: mocks.calendars,
  listLoadBalancingTransferRulesResolved: mocks.rules, buildWorkCalendarModeMap: (items: Array<{ resourceCd: string; workCalendarMode: string }>) => new Map(items.map((item) => [item.resourceCd, item.workCalendarMode]))
}));

import { clearLoadBalancingWorkspaceSourceCacheForTests } from '../load-balancing-workspace-source-cache.js';
import { getProductionScheduleLoadBalancingWorkspace, getProductionScheduleLoadBalancingWorkspaceDay } from '../load-balancing-workspace.service.js';

const params = { siteKeyInput: 'site', deviceScopeKey: 'device', dueSource: 'excel' as const, fromMonth: '2026-11', toMonth: '2026-12', now: new Date('2026-11-06T00:00:00Z') };

describe('workspace cache wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearLoadBalancingWorkspaceSourceCacheForTests();
    mocks.generation.mockResolvedValue('g1');
    mocks.revision.mockResolvedValue({ _count: 1, _max: { updatedAt: new Date('2026-11-01') } });
    mocks.winners.mockResolvedValue(['r1']);
    mocks.names.mockResolvedValue({ machineNames: { S1: '研削盤' } });
    mocks.query.mockResolvedValue([{ rowId: 'r1', fseiban: 'S1', productNo: '1', fhincd: 'P1', fhinmei: '部品', fkojun: '1', resourceCd: '001', requiredMinutes: 600,
      plannedStartDate: new Date('2026-11-06'), effectiveDueDate: new Date('2026-11-30') }]);
    mocks.base.mockResolvedValue({ siteKey: 'site', items: [{ resourceCd: '001', baseAvailableMinutes: 100 }] });
    mocks.monthly.mockResolvedValue({ siteKey: 'site', itemsByMonth: {} });
    for (const mock of [mocks.classes, mocks.calendars, mocks.rules]) mock.mockResolvedValue({ siteKey: 'site', items: [] });
  });

  it('starts machine names before the row query finishes and shares the source with day requests', async () => {
    let finishRows!: (rows: []) => void;
    mocks.query.mockReturnValueOnce(new Promise<[]>((resolve) => { finishRows = resolve; }));
    const pending = getProductionScheduleLoadBalancingWorkspace(params);
    await vi.waitFor(() => expect(mocks.names).toHaveBeenCalledWith({ winnerRowIds: ['r1'] }));
    finishRows([]);
    await pending;
    await getProductionScheduleLoadBalancingWorkspaceDay({ ...params, month: '2026-11', resourceCd: '001' });
    expect(mocks.winners).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('reuses results but reflects all settings immediately without reloading rows', async () => {
    const first = await getProductionScheduleLoadBalancingWorkspace(params);
    expect((await getProductionScheduleLoadBalancingWorkspace(params))).toBe(first);
    mocks.base.mockResolvedValue({ siteKey: 'site', items: [{ resourceCd: '001', baseAvailableMinutes: 200 }] });
    const capacityChanged = await getProductionScheduleLoadBalancingWorkspace(params);
    expect(capacityChanged.resources[0]?.capacityByMonth['2026-11']).toBe(200);
    expect(capacityChanged.rows).toEqual(first.rows);
    mocks.monthly.mockResolvedValue({ siteKey: 'site', itemsByMonth: { '2026-11': [{ resourceCd: '001', availableMinutes: 300 }] } });
    const monthlyChanged = await getProductionScheduleLoadBalancingWorkspace(params);
    expect(monthlyChanged.resources[0]?.capacityByMonth['2026-11']).toBe(300);
    mocks.classes.mockResolvedValue({ siteKey: 'site', items: [{ resourceCd: '001', classCode: 'B' }] });
    expect((await getProductionScheduleLoadBalancingWorkspace(params)).resources[0]?.classCode).toBe('B');
    mocks.calendars.mockResolvedValue({ siteKey: 'site', items: [{ resourceCd: '001', workCalendarMode: 'calendar_days' }] });
    expect((await getProductionScheduleLoadBalancingWorkspace(params)).resources[0]?.workCalendarMode).toBe('calendar_days');
    mocks.rules.mockResolvedValue({ siteKey: 'site', items: [{ fromClassCode: 'B', toClassCode: 'C', priority: 1, efficiencyRatio: 0.8, enabled: true }] });
    expect((await getProductionScheduleLoadBalancingWorkspace(params)).transferRules).toHaveLength(1);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it('invalidates on board and machine supplement generations, keeping due source/range/day/scope separate', async () => {
    const first = await getProductionScheduleLoadBalancingWorkspace(params);
    mocks.generation.mockResolvedValue('g2');
    expect(await getProductionScheduleLoadBalancingWorkspace(params)).toBe(first);
    mocks.revision.mockResolvedValue({ _count: 2, _max: { updatedAt: new Date('2026-11-02') } });
    await getProductionScheduleLoadBalancingWorkspace(params);
    await getProductionScheduleLoadBalancingWorkspace({ ...params, dueSource: 'scaw' });
    await getProductionScheduleLoadBalancingWorkspace({ ...params, toMonth: '2027-01' });
    await getProductionScheduleLoadBalancingWorkspace({ ...params, now: new Date('2026-11-07') });
    await getProductionScheduleLoadBalancingWorkspace({ ...params, deviceScopeKey: 'other' });
    expect(mocks.query).toHaveBeenCalledTimes(7);
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ dueSource: 'scaw' }));
  });
});
