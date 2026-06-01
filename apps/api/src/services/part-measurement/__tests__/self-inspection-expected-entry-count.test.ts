import { describe, expect, it } from 'vitest';

import {
  resolveLegacyFullSelfInspectionBlockedReason,
  resolveRequiredEntryCountForCompletion,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT,
  SelfInspectionService,
  tryResolveExpectedEntryCount
} from '../self-inspection.service.js';

describe('legacy full-inspection session entry counts', () => {
  const fullTemplate = { selfInspectionMode: 'FULL' as const };

  it('blocks misaligned sessions when planned quantity exceeds the business limit', () => {
    expect(
      resolveLegacyFullSelfInspectionBlockedReason({
        expectedEntryCount: 2000,
        plannedQuantity: 50_000,
        template: fullTemplate
      })
    ).toMatch(/旧形式/);
  });

  it('allows writable range to match completion for repairable misaligned sessions', () => {
    const session = {
      expectedEntryCount: 2,
      plannedQuantity: 5,
      template: fullTemplate
    };
    expect(resolveLegacyFullSelfInspectionBlockedReason(session)).toBeNull();
    expect(resolveRequiredEntryCountForCompletion(session)).toBe(5);
  });
});

describe('tryResolveExpectedEntryCount', () => {
  it('rejects full inspection when planned quantity exceeds the business limit', () => {
    expect(
      tryResolveExpectedEntryCount(
        { selfInspectionMode: 'FULL', selfInspectionSampleSize: null },
        50_000
      )
    ).toBeNull();
  });

  it('uses the full planned quantity when within the business limit', () => {
    expect(
      tryResolveExpectedEntryCount(
        { selfInspectionMode: 'FULL', selfInspectionSampleSize: null },
        120
      )
    ).toBe(120);
  });

  it('allows sample inspection when planned quantity exceeds the full-inspection limit', () => {
    expect(
      tryResolveExpectedEntryCount(
        { selfInspectionMode: 'SAMPLE', selfInspectionSampleSize: 5 },
        50_000
      )
    ).toBe(5);
  });

  it('rejects sample size above planned quantity', () => {
    expect(
      tryResolveExpectedEntryCount(
        { selfInspectionMode: 'SAMPLE', selfInspectionSampleSize: 10 },
        5
      )
    ).toBeNull();
  });
});

describe('SelfInspectionService buildLeaderboardDecorations sample guard', () => {
  const service = new SelfInspectionService();

  it('does not throw when a row has sample size greater than planned quantity', async () => {
    const decorations = await service.buildLeaderboardDecorations(
      [
        {
          id: 'row-over-sample',
          rowData: {
            ProductNo: 'PN1',
            FHINCD: 'NO-SUCH-TEMPLATE-XYZ',
            FHINMEI: '品',
            FSIGENCD: '999',
            FSEIBAN: 'FS1'
          },
          plannedQuantity: 5
        }
      ],
      {}
    );
    expect(decorations).toHaveLength(1);
    expect(decorations[0]?.hasSelfInspectionDrawing).toBe(false);
    expect(decorations[0]?.selfInspectionEntryPath).toBeNull();
  });

  it('does not expose start path when planned quantity is missing', async () => {
    const decorations = await service.buildLeaderboardDecorations(
      [
        {
          id: 'row-no-qty',
          rowData: {
            ProductNo: 'PN1',
            FHINCD: 'H1',
            FHINMEI: '品',
            FSIGENCD: '581',
            FSEIBAN: 'FS1'
          },
          plannedQuantity: null
        }
      ],
      {}
    );
    expect(decorations[0]?.hasSelfInspectionDrawing).toBe(false);
    expect(decorations[0]?.selfInspectionEntryPath).toBeNull();
  });
});
