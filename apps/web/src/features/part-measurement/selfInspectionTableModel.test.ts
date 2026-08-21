import { describe, expect, it } from 'vitest';

import {
  makeSelfInspectionSessionDetailForTest,
  makeSelfInspectionTemplateItemForTest
} from './__tests__/selfInspectionSessionTestFixtures';
import {
  KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
  kioskSelfInspectionInspectorSessionPath
} from './selfInspectionRoutes';
import {
  buildProductFilterOptions,
  buildResourceFilterOptions,
  presentSelfInspectionSessionRow,
  splitIntoBalancedPanes
} from './selfInspectionTableModel';

const rows = [
  {
    productNo: '1001',
    fseiban: 'A-01',
    resourceCd: '581',
    fhincd: 'P-1',
    fhinmei: '部品A'
  },
  {
    productNo: '1001',
    fseiban: 'A-02',
    resourceCd: '582',
    fhincd: 'P-2',
    fhinmei: '部品B'
  },
  {
    productNo: '1002',
    fseiban: null,
    resourceCd: '581',
    fhincd: 'P-3',
    fhinmei: '部品C'
  },
  {
    productNo: '1003',
    fseiban: 'A-03',
    resourceCd: ' ',
    fhincd: 'P-4',
    fhinmei: '部品D'
  }
];

describe('splitIntoBalancedPanes', () => {
  it.each([
    { items: [], panes: 3, sizes: [0, 0, 0] },
    { items: [1], panes: 3, sizes: [1, 0, 0] },
    { items: [1, 2], panes: 2, sizes: [1, 1] },
    { items: [1, 2, 3, 4, 5], panes: 3, sizes: [2, 2, 1] }
  ])('keeps contiguous order for $items.length items across $panes panes', ({ items, panes, sizes }) => {
    const result = splitIntoBalancedPanes(items, panes);
    expect(result.map((pane) => pane.length)).toEqual(sizes);
    expect(result.flat()).toEqual(items);
  });

  it('normalizes invalid pane counts to one pane', () => {
    expect(splitIntoBalancedPanes([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});

describe('self-inspection filter options', () => {
  it('deduplicates products by product number and preserves first rendered order', () => {
    expect(buildProductFilterOptions(rows).map((option) => option.value)).toEqual(['1001', '1002', '1003']);
    expect(buildProductFilterOptions(rows)[0]?.label).toBe('1001 / 製番 A-01 / 品番 P-1 / 資源 581');
  });

  it('deduplicates resources and excludes blank values', () => {
    expect(buildResourceFilterOptions(rows).map((option) => option.value)).toEqual(['581', '582']);
  });
});

describe('self-inspection workflow actions', () => {
  it('keeps a completed inspector measurement on the inspector screen for final judgement', () => {
    const session = makeSelfInspectionSessionDetailForTest({
      items: [makeSelfInspectionTemplateItemForTest({ id: 'p1', sortOrder: 0 })]
    });
    session.completedEntryCount = 1;
    session.recordApprovalRequiredAt = session.startedAt;
    session.inspectorRemeasurementRequiredAt = session.startedAt;
    session.inspectorMeasurementState = 'complete';
    session.decisionWorkflow = 'INSPECTOR_FINAL_JUDGEMENT';

    const row = presentSelfInspectionSessionRow(session);
    expect(row.actions).toEqual([
      {
        kind: 'link',
        href: kioskSelfInspectionInspectorSessionPath(session.id),
        label: '検査員測定',
        tone: 'primary'
      },
      {
        kind: 'link',
        href: `${KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH}?sessionId=${session.id}`,
        label: '記録確認',
        tone: 'secondary'
      }
    ]);
    expect(row.statusLabel).toBe('最終判定待ち');
  });

  it('keeps legacy sessions on the existing record approval screen', () => {
    const session = makeSelfInspectionSessionDetailForTest({
      items: [makeSelfInspectionTemplateItemForTest({ id: 'p1', sortOrder: 0 })]
    });
    session.completedEntryCount = 1;
    session.recordApprovalRequiredAt = session.startedAt;
    session.inspectorRemeasurementRequiredAt = session.startedAt;
    session.inspectorMeasurementState = 'complete';
    session.decisionWorkflow = 'LEGACY_RECORD_APPROVAL';

    expect(presentSelfInspectionSessionRow(session).actions).toEqual([
      {
        kind: 'link',
        href: KIOSK_SELF_INSPECTION_RECORD_APPROVALS_PATH,
        label: '記録確認',
        tone: 'primary'
      }
    ]);
  });

  it('shows operator resume and inspector measurement together while a lot is partially confirmed', () => {
    const session = makeSelfInspectionSessionDetailForTest({
      expectedEntryCount: 5,
      items: [makeSelfInspectionTemplateItemForTest({ id: 'p1', sortOrder: 0 })]
    });
    session.completedEntryCount = 2;
    session.recordApprovalRequiredAt = session.startedAt;
    session.inspectorRemeasurementRequiredAt = session.startedAt;
    session.inspectorMeasurementState = 'in_progress';
    session.inspectorCompletedRequiredEntryCount = 1;
    session.inspectorRequiredEntryCount = 5;

    const row = presentSelfInspectionSessionRow(session);
    expect(row.progressLine).toContain('作業者 2/5件 / 検査員 1/5件');
    expect(row.actions.map((action) => action.label)).toEqual(['再開', '検査員測定', '記録確認']);
  });
});
