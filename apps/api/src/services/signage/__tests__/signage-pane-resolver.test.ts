import { describe, expect, it } from 'vitest';
import { resolveSplitPanes } from '../signage-pane-resolver.js';
import type { SignageContentResponse } from '../signage.service.js';
import type { SignageLayoutConfig } from '../signage-layout.types.js';

describe('resolveSplitPanes', () => {
  const getPdfPageIndex = () => 0;

  it('should resolve left=loans right=visualization with tools=[] (loans=0)', () => {
    const layoutConfig: SignageLayoutConfig = {
      layout: 'SPLIT',
      slots: [
        { position: 'LEFT', kind: 'loans', config: {} },
        {
          position: 'RIGHT',
          kind: 'visualization',
          config: { visualizationDashboardId: 'dec30c54-8845-431d-9dba-3fbe0b70a332' },
        },
      ],
    };

    const content: SignageContentResponse = {
      contentType: 'SPLIT',
      displayMode: 'SINGLE',
      layoutConfig,
      tools: [],
    };

    const result = resolveSplitPanes(layoutConfig, content, getPdfPageIndex);

    expect(result).not.toBeNull();
    expect(result!.left.kind).toBe('loans');
    expect(result!.left.tools).toEqual([]);
    expect(result!.right.kind).toBe('visualization');
    expect(result!.right.visualizationDashboardId).toBe('dec30c54-8845-431d-9dba-3fbe0b70a332');
  });

  it('should resolve left=loans right=visualization with tools (loans>0)', () => {
    const layoutConfig: SignageLayoutConfig = {
      layout: 'SPLIT',
      slots: [
        { position: 'LEFT', kind: 'loans', config: {} },
        {
          position: 'RIGHT',
          kind: 'visualization',
          config: { visualizationDashboardId: 'dec30c54-8845-431d-9dba-3fbe0b70a332' },
        },
      ],
    };

    const content: SignageContentResponse = {
      contentType: 'SPLIT',
      displayMode: 'SINGLE',
      layoutConfig,
      tools: [
        {
          id: 'loan-1',
          itemCode: 'ITEM-001',
          name: 'トルクレンチ',
          thumbnailUrl: null,
          employeeName: '山田',
          borrowedAt: '2026-03-06T00:00:00Z',
        },
      ],
    };

    const result = resolveSplitPanes(layoutConfig, content, getPdfPageIndex);

    expect(result).not.toBeNull();
    expect(result!.left.kind).toBe('loans');
    expect(result!.left.tools).toHaveLength(1);
    expect(result!.left.tools![0].name).toBe('トルクレンチ');
    expect(result!.right.kind).toBe('visualization');
  });

  it('should return null for non-SPLIT layout', () => {
    const layoutConfig: SignageLayoutConfig = {
      layout: 'FULL',
      slots: [{ position: 'FULL', kind: 'loans', config: {} }],
    };

    const content: SignageContentResponse = {
      contentType: 'TOOLS',
      displayMode: 'SINGLE',
      tools: [],
    };

    const result = resolveSplitPanes(layoutConfig, content, getPdfPageIndex);

    expect(result).toBeNull();
  });
});
