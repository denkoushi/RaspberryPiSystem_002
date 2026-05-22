import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RiggingInspectionDedupPolicy } from '../rigging-inspection-dedup.policy.js';

function createClient() {
  return {
    riggingInspectionRecord: {
      findFirst: vi.fn(),
    },
  };
}

describe('RiggingInspectionDedupPolicy', () => {
  let client: ReturnType<typeof createClient>;
  let policy: RiggingInspectionDedupPolicy;

  beforeEach(() => {
    client = createClient();
    policy = new RiggingInspectionDedupPolicy(client as never);
  });

  it('returns the existing record when one exists in the same JST business day window', async () => {
    client.riggingInspectionRecord.findFirst.mockResolvedValue({
      id: 'rec-1',
      inspectedAt: new Date('2026-04-30T02:00:00.000Z'),
    });

    const existing = await policy.findForBusinessDay({
      riggingGearId: 'gear-1',
      employeeId: 'emp-1',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
    });

    expect(existing).toEqual({
      id: 'rec-1',
      inspectedAt: new Date('2026-04-30T02:00:00.000Z'),
    });
    expect(await policy.existsForBusinessDay({
      riggingGearId: 'gear-1',
      employeeId: 'emp-1',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
    })).toBe(true);
    expect(client.riggingInspectionRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          riggingGearId: 'gear-1',
          employeeId: 'emp-1',
          inspectedAt: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
      }),
    );
  });

  it('returns null when no record exists', async () => {
    client.riggingInspectionRecord.findFirst.mockResolvedValue(null);

    const existing = await policy.findForBusinessDay({
      riggingGearId: 'gear-1',
      employeeId: 'emp-1',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
    });

    expect(existing).toBeNull();
    expect(await policy.existsForBusinessDay({
      riggingGearId: 'gear-1',
      employeeId: 'emp-1',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
    })).toBe(false);
  });
});
