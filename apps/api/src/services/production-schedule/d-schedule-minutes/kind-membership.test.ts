import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { listDScheduleMinutesKinds } from './kind-membership.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: { productionScheduleDScheduleMinutesKindMembership: { findMany: vi.fn() } }
}));

const findMany = vi.mocked(prisma.productionScheduleDScheduleMinutesKindMembership.findMany);
afterEach(() => vi.resetAllMocks());

describe('listDScheduleMinutesKinds', () => {
  it('groups both kinds in D_COMPANY then INTERNAL order for the dashboard', async () => {
    findMany.mockResolvedValue([
      { fseiban: 'BOTH', kind: 'D_COMPANY' },
      { fseiban: 'D_ONLY', kind: 'D_COMPANY' },
      { fseiban: 'BOTH', kind: 'INTERNAL' },
      { fseiban: 'GENERAL', kind: 'INTERNAL' }
    ] as Awaited<ReturnType<typeof findMany>>);
    expect(await listDScheduleMinutesKinds({ csvDashboardId: 'dashboard' })).toEqual(new Map([
      ['BOTH', ['D_COMPANY', 'INTERNAL']], ['D_ONLY', ['D_COMPANY']], ['GENERAL', ['INTERNAL']]
    ]));
    expect(findMany).toHaveBeenCalledWith({ where: { csvDashboardId: 'dashboard' },
      select: { fseiban: true, kind: true }, orderBy: { kind: 'asc' } });
  });

  it.each([['BOTH'], []])('filters by supplied seibans %j, including an empty list', async (...fseibans: string[]) => {
    findMany.mockResolvedValue([]);
    expect(await listDScheduleMinutesKinds({ csvDashboardId: 'dashboard', fseibans })).toEqual(new Map());
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { csvDashboardId: 'dashboard', fseiban: { in: fseibans } }
    }));
  });

  it('does not expose unknown stored kinds as DScheduleMinutesKind', async () => {
    findMany.mockResolvedValue([{ fseiban: 'OTHER', kind: 'UNKNOWN' }] as Awaited<ReturnType<typeof findMany>>);
    expect(await listDScheduleMinutesKinds({ csvDashboardId: 'dashboard' })).toEqual(new Map());
  });
});
