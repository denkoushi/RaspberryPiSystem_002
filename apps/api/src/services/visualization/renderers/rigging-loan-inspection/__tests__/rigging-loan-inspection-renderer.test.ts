import { describe, expect, it } from 'vitest';

import { resolveRiggingHasVisibleLoanState } from '../rigging-loan-inspection-renderer.js';

describe('resolveRiggingHasVisibleLoanState', () => {
  it('returns true when active loan count is positive', () => {
    expect(
      resolveRiggingHasVisibleLoanState(
        { 従業員名: '石井 和也', 点検件数: 1 },
        { activeLoanCount: 1, returnedLoanCount: 0 },
        { inspectionCountColumn: '点検件数' },
      ),
    ).toBe(true);
  });

  it('returns true when returned loan count is positive', () => {
    expect(
      resolveRiggingHasVisibleLoanState(
        { 従業員名: '山田 太郎', 点検件数: 0 },
        { activeLoanCount: 0, returnedLoanCount: 2 },
        { inspectionCountColumn: '点検件数' },
      ),
    ).toBe(true);
  });

  it('returns true for inspection-only rows (CSV projection, no loan)', () => {
    expect(
      resolveRiggingHasVisibleLoanState(
        { 従業員名: '矢田 彗遥', 点検件数: 2 },
        { activeLoanCount: 0, returnedLoanCount: 0 },
        { inspectionCountColumn: '点検件数' },
      ),
    ).toBe(true);
  });

  it('returns false when there is no loan and no inspection today', () => {
    expect(
      resolveRiggingHasVisibleLoanState(
        { 従業員名: '遠藤 亜生', 点検件数: 0 },
        { activeLoanCount: 0, returnedLoanCount: 0 },
        { inspectionCountColumn: '点検件数' },
      ),
    ).toBe(false);
  });

  it('renders JPEG for inspection-only row (no loan)', async () => {
    const { RiggingLoanInspectionRenderer } = await import('../rigging-loan-inspection-renderer.js');
    const renderer = new RiggingLoanInspectionRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['従業員名', '点検件数', '貸出中吊具数', '返却件数', '吊具名称一覧', '吊具明細'],
        rows: [
          {
            従業員名: '矢田 彗遥',
            点検件数: 2,
            貸出中吊具数: 0,
            返却件数: 0,
            吊具名称一覧: 'M02G (チェーンスリング)',
            吊具明細: JSON.stringify([
              { kind: 'active', managementNumber: 'M02G', name: 'チェーンスリング' },
            ]),
          },
        ],
        metadata: { targetDate: '2026-05-22', totalUsers: 1, inspectedUsers: 1 },
      },
      { width: 1280, height: 720, title: '吊具持出状況' },
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });
});
