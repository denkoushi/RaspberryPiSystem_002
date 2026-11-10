import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listKinds = vi.hoisted(() => vi.fn());
vi.mock('../d-schedule-minutes/kind-membership.js', () => ({ listDScheduleMinutesKinds: listKinds }));

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { mergeScheduleSourceOrder, readScheduleSourceExcludedFseibans, withScheduleSourceWhere } from '../grinding-planning-board/schedule-source.js';

describe('planning board schedule source', () => {
  it.each([['hidden', 'a', 'b'], ['a', 'hidden', 'b'], ['a', 'b', 'hidden']])('retains hidden slots in %j', (...full) => {
    const result = mergeScheduleSourceOrder(full, ['b', 'a']);
    expect(result.indexOf('hidden')).toBe(full.indexOf('hidden'));
    expect(result.filter((id) => id !== 'hidden')).toEqual(['b', 'a']);
  });
  beforeEach(() => {
    listKinds.mockReset().mockResolvedValue(new Map([
      ['D', ['D_COMPANY']], ['GENERAL', ['INTERNAL']], ['DUAL', ['INTERNAL', 'D_COMPANY']]
    ]));
  });

  it.each([
    ['dCompany', ['D', 'DUAL', 'MANUAL'], ['GENERAL']],
    ['general', ['GENERAL', 'DUAL', 'MANUAL'], ['D']]
  ] as const)('keeps %s, dual and manual seibans', async (source, visible, excluded) => {
    const registered = ['D', 'GENERAL', 'DUAL', 'MANUAL'];
    const result = await readScheduleSourceExcludedFseibans(source, registered);
    expect(result).toEqual(excluded);
    expect(registered.filter((fseiban) => !result.includes(fseiban))).toEqual(visible);
    expect(listKinds).toHaveBeenCalledExactlyOnceWith({ csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseibans: registered });
  });

  it.each([undefined, 'both'] as const)('preserves the original predicate without a membership read for %s', async (source) => {
    const base = Prisma.sql`"CsvDashboardRow"."csvDashboardId" = ${'dashboard'}`;
    const excluded = await readScheduleSourceExcludedFseibans(source);
    expect(excluded).toEqual([]);
    expect(listKinds).not.toHaveBeenCalled();
    expect(withScheduleSourceWhere(base, excluded)).toBe(base);
  });

  it('uses bound exclusions for the load predicate and keeps unknown seibans', async () => {
    const base = Prisma.sql`"CsvDashboardRow"."csvDashboardId" = ${'dashboard'}`;
    const filtered = withScheduleSourceWhere(base, await readScheduleSourceExcludedFseibans('general'));
    expect(filtered.sql).toContain('NOT IN (?)');
    expect(filtered.sql).toContain('COALESCE(BTRIM');
    expect(filtered.values).toEqual(['dashboard', 'D']);
  });
});
