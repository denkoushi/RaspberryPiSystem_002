import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { parseStructuredShelfCode } from '../mobile-placement-registered-shelves.service.js';
import { listShelfLayoutSummary, validateLayoutEntities } from '../shelf-layout-edit.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    mobilePlacementZoneLayout: {
      count: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn()
    }
  }
}));

describe('parseStructuredShelfCode tier', () => {
  it('parses 4-segment shelf code with tier', () => {
    expect(parseStructuredShelfCode('西-北-02-1')).toEqual({
      isStructured: true,
      areaId: 'west',
      lineId: 'north',
      slot: 2,
      tier: 1
    });
  });
});

describe('validateLayoutEntities', () => {
  it('rejects overlapping cells', () => {
    expect(() =>
      validateLayoutEntities(
        [
          { entityKind: 'SHELF', cellIndices: [0] },
          { entityKind: 'AISLE', cellIndices: [0] }
        ],
        3
      )
    ).toThrow();
  });
});

describe('listShelfLayoutSummary', () => {
  beforeEach(() => {
    vi.mocked(prisma.mobilePlacementZoneLayout.count).mockResolvedValue(9);
    vi.mocked(prisma.mobilePlacementZoneLayout.upsert).mockResolvedValue({} as never);
  });

  it('returns entities per zone for overview mini-map', async () => {
    vi.mocked(prisma.mobilePlacementZoneLayout.findMany).mockResolvedValue([
      {
        macroZoneId: 'c',
        gridSize: 3,
        entities: [
          {
            id: 'ent-1',
            entityKind: 'MACHINE',
            cellIndices: [0],
            resourceCd: 'RD01',
            resourceName: 'Robodrill01',
            aisleLabel: null,
            shelf: null,
            createdAt: new Date()
          },
          {
            id: 'ent-2',
            entityKind: 'SHELF',
            cellIndices: [2],
            resourceCd: null,
            resourceName: null,
            aisleLabel: null,
            shelf: { shelfCodeRaw: '中-中-01', displayLabel: 'Robodrill01南' },
            createdAt: new Date()
          }
        ]
      }
    ] as never);

    const { zones } = await listShelfLayoutSummary();
    const center = zones.find((z) => z.macroZoneId === 'c');
    expect(center?.entities).toHaveLength(2);
    expect(center?.entities[0]).toMatchObject({
      entityKind: 'MACHINE',
      resourceName: 'Robodrill01'
    });
    expect(center?.entities[1]).toMatchObject({
      entityKind: 'SHELF',
      shelfCodeRaw: '中-中-01',
      displayLabel: 'Robodrill01南'
    });
    expect(center?.shelfCount).toBe(1);
    expect(center?.machineCount).toBe(1);
  });
});
