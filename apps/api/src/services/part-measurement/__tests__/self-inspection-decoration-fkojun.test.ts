import { describe, expect, it } from 'vitest';

import {
  buildLeaderboardDecorations,
  type SelfInspectionDecorationCache
} from '../self-inspection/decoration.js';
import type { SelfInspectionTemplate } from '../self-inspection/shared.js';

function template(id: string, fkojun: string, siblingGroupId: string | null): SelfInspectionTemplate {
  return {
    id,
    fhincd: 'PART-1',
    processGroup: 'CUTTING',
    resourceCd: 'R1',
    fkojun,
    templateScope: 'THREE_KEY',
    isActive: true,
    siblingGroupId,
    selfInspectionMode: 'FULL',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    visualTemplate: { drawingImageRelativePath: '/drawing.png' },
    items: [{ markerXRatio: '0.5', markerYRatio: '0.5', lowerLimit: '9', upperLimit: '11', valueKind: 'NUMERIC' }]
  } as unknown as SelfInspectionTemplate;
}

function decorationCache(templates: SelfInspectionTemplate[]): SelfInspectionDecorationCache {
  return {
    policy: { grindingResourceCds: [], cuttingExcludedResourceCds: [] } as never,
    templateByKey: new Map(templates.map((value) => [
      `PART-1::CUTTING::${value.fkojun}::R1`, value
    ])),
    resourceCdsBySiblingGroupId: new Map([['group-10', ['R1', 'R2']]]),
    invalidatedScheduleRowIds: new Set(),
    sessionsByScheduleRowId: new Map([['row-1', null]])
  };
}

const row = {
  id: 'row-1',
  plannedQuantity: 5,
  rowData: {
    FKOJUN: 10,
    FSIGENCD: 'R1',
    FHINCD: 'PART-1',
    ProductNo: 'PO-1',
    FHINMEI: '品名',
    FSEIBAN: 'FS-1'
  }
};

describe('self-inspection schedule decoration FKOJUN selection', () => {
  it('prefers the matching FKOJUN template and exposes its active sibling resources', async () => {
    const result = await buildLeaderboardDecorations(
      [row],
      {},
      decorationCache([template('order-10', '10', 'group-10'), template('legacy', '', null)])
    );

    expect(result[0]?.selfInspectionTemplateId).toBe('order-10');
    expect(result[0]?.selfInspectionResourceCds).toEqual(['R1', 'R2']);
  });

  it('falls back to the blank-FKOJUN template for legacy schedule rows', async () => {
    const result = await buildLeaderboardDecorations(
      [{ ...row, rowData: { ...row.rowData, FKOJUN: 20 } }],
      {},
      decorationCache([template('legacy', '', null)])
    );

    expect(result[0]?.selfInspectionTemplateId).toBe('legacy');
    expect(result[0]?.selfInspectionResourceCds).toEqual(['R1']);
  });
});
