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

  it('returns true when a record exists in the same JST business day window', async () => {
    client.riggingInspectionRecord.findFirst.mockResolvedValue({ id: 'rec-1' });

    const exists = await policy.existsForBusinessDay({
      riggingGearId: 'gear-1',
      employeeId: 'emp-1',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
    });

    expect(exists).toBe(true);
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

  it('returns false when no record exists', async () => {
    client.riggingInspectionRecord.findFirst.mockResolvedValue(null);

    const exists = await policy.existsForBusinessDay({
      riggingGearId: 'gear-1',
      employeeId: 'emp-1',
      inspectedAt: new Date('2026-04-30T01:00:00.000Z'),
    });

    expect(exists).toBe(false);
  });
});
