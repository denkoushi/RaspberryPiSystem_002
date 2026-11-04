import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    productionScheduleDailyPlan: { upsert: vi.fn() },
    productionScheduleDailyPlanItem: { deleteMany: vi.fn(), createMany: vi.fn() }
  };
  return {
    tx,
    findUnique: vi.fn(),
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    listGlobalRank: vi.fn(),
    mergeGlobalRank: vi.fn(),
    saveDecisionEvent: vi.fn(),
    resolveSiteKey: vi.fn((key: string) => `site-of-${key}`)
  };
});

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleDailyPlan: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction
  }
}));
vi.mock('../../../lib/site-directory.js', () => ({ resolveSiteKeyForScopeKey: mocks.resolveSiteKey }));
vi.mock('../due-management-global-rank.service.js', () => ({
  listDueManagementGlobalRank: mocks.listGlobalRank,
  mergeDueManagementGlobalRank: mocks.mergeGlobalRank
}));
vi.mock('../due-management-learning-event.repository.js', () => ({
  dueManagementLearningEventRepository: { saveDecisionEvent: mocks.saveDecisionEvent }
}));

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildDueManagementDailyPlanSeed } from '../due-management-carryover.service.js';
import { getDueManagementDailyPlan, replaceDueManagementDailyPlan } from '../due-management-daily-plan.service.js';

const planDateArg = (callIndex = 0): Date =>
  mocks.findUnique.mock.calls[callIndex][0].where.csvDashboardId_location_planDate.planDate as Date;

describe('due management daily plan / carryover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.findUnique.mockReset().mockResolvedValue(null);
    mocks.listGlobalRank.mockReset().mockResolvedValue([]);
    mocks.mergeGlobalRank.mockReset().mockResolvedValue([]);
    mocks.saveDecisionEvent.mockReset().mockResolvedValue(undefined);
    mocks.tx.productionScheduleDailyPlan.upsert.mockReset();
    mocks.tx.productionScheduleDailyPlanItem.deleteMany.mockReset();
    mocks.tx.productionScheduleDailyPlanItem.createMany.mockReset();
    mocks.transaction.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buildDueManagementDailyPlanSeed', () => {
    it('looks up yesterday by JST calendar date (UTC 15:00 boundary)', async () => {
      vi.setSystemTime(new Date('2026-11-04T14:59:59.999Z')); // 2026-11-04 23:59 JST
      await buildDueManagementDailyPlanSeed({ locationKey: 'loc', selectedFseibans: [] });
      expect(planDateArg(0).toISOString()).toBe('2026-11-03T00:00:00.000Z');

      vi.setSystemTime(new Date('2026-11-04T15:00:00.000Z')); // 2026-11-05 00:00 JST
      await buildDueManagementDailyPlanSeed({ locationKey: 'loc', selectedFseibans: [] });
      expect(planDateArg(1).toISOString()).toBe('2026-11-04T00:00:00.000Z');
    });

    it('rolls yesterday over month/year boundaries', async () => {
      vi.setSystemTime(new Date('2027-01-01T03:00:00.000Z')); // 2027-01-01 12:00 JST
      await buildDueManagementDailyPlanSeed({ locationKey: 'loc', selectedFseibans: [] });
      expect(planDateArg(0).toISOString()).toBe('2026-12-31T00:00:00.000Z');
    });

    it('puts selected seibans first in base order, then carryovers, de-duplicated', async () => {
      vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
      mocks.findUnique.mockResolvedValue({ items: [{ fseiban: 'Y1' }, { fseiban: 'S2' }, { fseiban: 'Y2' }] });
      mocks.listGlobalRank.mockResolvedValue(['G1', 'Y1', 'S1']);

      const result = await buildDueManagementDailyPlanSeed({
        locationKey: 'loc',
        selectedFseibans: [' S1 ', 'S2', 'S3', 'S1', '']
      });

      expect(mocks.findUnique.mock.calls[0][0].where.csvDashboardId_location_planDate).toMatchObject({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: 'loc'
      });
      expect(mocks.listGlobalRank).toHaveBeenCalledWith({ locationKey: 'loc', targetLocation: 'loc', scope: 'globalShared' });
      // base order: yesterday(Y1,S2,Y2) + global(G1,S1) + selected(S3)
      expect(result.orderedFseibans).toEqual(['S2', 'S1', 'S3', 'Y1', 'Y2', 'G1']);
      expect(result.items).toEqual([
        { fseiban: 'S2', isInTodayTriage: true, isCarryover: false },
        { fseiban: 'S1', isInTodayTriage: true, isCarryover: false },
        { fseiban: 'S3', isInTodayTriage: true, isCarryover: false },
        { fseiban: 'Y1', isInTodayTriage: false, isCarryover: true },
        { fseiban: 'Y2', isInTodayTriage: false, isCarryover: true },
        { fseiban: 'G1', isInTodayTriage: false, isCarryover: true }
      ]);
    });

    it('returns an empty plan when nothing exists anywhere', async () => {
      vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
      expect(await buildDueManagementDailyPlanSeed({ locationKey: 'loc', selectedFseibans: [] })).toEqual({
        orderedFseibans: [],
        items: []
      });
    });
  });

  describe('getDueManagementDailyPlan', () => {
    it("returns today's saved plan order and flags carryovers against selection", async () => {
      vi.setSystemTime(new Date('2026-11-04T16:00:00.000Z')); // 2026-11-05 01:00 JST
      mocks.findUnique.mockResolvedValueOnce({
        status: 'confirmed',
        confirmedAt: new Date('2026-11-04T20:00:00.000Z'),
        updatedAt: new Date('2026-11-04T21:00:00.000Z'),
        items: [{ fseiban: 'B' }, { fseiban: 'A' }]
      });

      const plan = await getDueManagementDailyPlan({ locationKey: 'loc', selectedFseibans: [' A '] });

      expect(planDateArg(0).toISOString()).toBe('2026-11-05T00:00:00.000Z');
      expect(plan).toEqual({
        planDate: '2026-11-05',
        status: 'confirmed',
        confirmedAt: '2026-11-04T20:00:00.000Z',
        updatedAt: '2026-11-04T21:00:00.000Z',
        items: [
          { fseiban: 'B', isInTodayTriage: false, isCarryover: true },
          { fseiban: 'A', isInTodayTriage: true, isCarryover: false }
        ],
        orderedFseibans: ['B', 'A']
      });
      // saved plan short-circuits the seed (no global rank read)
      expect(mocks.listGlobalRank).not.toHaveBeenCalled();
    });

    it('falls back to the seed (and keeps existing plan metadata) when today has no items', async () => {
      vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
      mocks.findUnique
        .mockResolvedValueOnce({ status: 'confirmed', confirmedAt: null, updatedAt: null, items: [] })
        .mockResolvedValueOnce({ items: [{ fseiban: 'Y' }] });
      mocks.listGlobalRank.mockResolvedValue([]);

      const plan = await getDueManagementDailyPlan({ locationKey: 'loc', selectedFseibans: ['S'] });

      expect(plan.planDate).toBe('2026-11-04');
      expect(plan.status).toBe('confirmed');
      expect(plan.orderedFseibans).toEqual(['S', 'Y']);
      expect(planDateArg(1).toISOString()).toBe('2026-11-03T00:00:00.000Z');
    });

    it('reports draft status when no plan row exists', async () => {
      vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
      const plan = await getDueManagementDailyPlan({ locationKey: 'loc', selectedFseibans: [] });
      expect(plan).toMatchObject({ status: 'draft', confirmedAt: null, updatedAt: null, orderedFseibans: [] });
    });
  });

  describe('replaceDueManagementDailyPlan', () => {
    it('resets the plan to draft, rewrites items with 1-based priority and merges global rank', async () => {
      vi.setSystemTime(new Date('2026-11-04T15:30:00.000Z')); // 2026-11-05 JST
      mocks.tx.productionScheduleDailyPlan.upsert.mockResolvedValue({
        id: 'plan-1',
        status: 'draft',
        confirmedAt: null,
        updatedAt: new Date('2026-11-04T15:30:00.000Z')
      });
      mocks.listGlobalRank.mockResolvedValue(['OLD']);
      mocks.mergeGlobalRank.mockResolvedValue(['B', 'A', 'OLD']);

      const plan = await replaceDueManagementDailyPlan({ locationKey: 'loc', orderedFseibans: [' B ', 'A', 'B', ''] });

      const upsertArg = mocks.tx.productionScheduleDailyPlan.upsert.mock.calls[0][0];
      expect(upsertArg.where.csvDashboardId_location_planDate.planDate.toISOString()).toBe('2026-11-05T00:00:00.000Z');
      expect(upsertArg.update).toEqual({ status: 'draft', confirmedAt: null });
      expect(upsertArg.create).toMatchObject({ location: 'loc', status: 'draft' });
      expect(mocks.tx.productionScheduleDailyPlanItem.deleteMany).toHaveBeenCalledWith({ where: { planId: 'plan-1' } });
      expect(mocks.tx.productionScheduleDailyPlanItem.createMany).toHaveBeenCalledWith({
        data: [
          { planId: 'plan-1', fseiban: 'B', priorityOrder: 1 },
          { planId: 'plan-1', fseiban: 'A', priorityOrder: 2 }
        ]
      });

      expect(mocks.mergeGlobalRank).toHaveBeenCalledWith({
        locationKey: 'loc',
        targetLocation: 'loc',
        scope: 'globalShared',
        prioritizedFseibans: ['B', 'A']
      });
      expect(mocks.saveDecisionEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          locationKey: 'loc',
          sourceType: 'manual',
          orderedFseibans: ['B', 'A', 'OLD'],
          previousOrderedFseibans: ['OLD'],
          proposalOrderedFseibans: ['B', 'A'],
          reorderDeltaRatio: null,
          metadata: { from: 'daily_plan_replace', actorLocation: 'loc', targetLocation: 'loc', scope: 'globalShared' }
        })
      );

      expect(plan).toEqual({
        planDate: '2026-11-05',
        status: 'draft',
        confirmedAt: null,
        updatedAt: '2026-11-04T15:30:00.000Z',
        items: [
          { fseiban: 'B', isInTodayTriage: true, isCarryover: false },
          { fseiban: 'A', isInTodayTriage: true, isCarryover: false }
        ],
        orderedFseibans: ['B', 'A']
      });
    });

    it('clears items without creating new ones for an empty order', async () => {
      vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
      mocks.tx.productionScheduleDailyPlan.upsert.mockResolvedValue({ id: 'p', status: 'draft', confirmedAt: null, updatedAt: null });
      const plan = await replaceDueManagementDailyPlan({ locationKey: 'loc', orderedFseibans: ['  '] });
      expect(mocks.tx.productionScheduleDailyPlanItem.deleteMany).toHaveBeenCalledTimes(1);
      expect(mocks.tx.productionScheduleDailyPlanItem.createMany).not.toHaveBeenCalled();
      expect(plan.items).toEqual([]);
    });

    it('does not touch global rank when the transaction fails', async () => {
      vi.setSystemTime(new Date('2026-11-04T03:00:00.000Z'));
      mocks.tx.productionScheduleDailyPlan.upsert.mockRejectedValue(new Error('db down'));
      await expect(replaceDueManagementDailyPlan({ locationKey: 'loc', orderedFseibans: ['A'] })).rejects.toThrow('db down');
      expect(mocks.mergeGlobalRank).not.toHaveBeenCalled();
      expect(mocks.saveDecisionEvent).not.toHaveBeenCalled();
    });
  });
});
