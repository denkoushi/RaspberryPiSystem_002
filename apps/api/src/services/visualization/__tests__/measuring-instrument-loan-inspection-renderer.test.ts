import { describe, expect, it } from 'vitest';
import { MeasuringInstrumentLoanInspectionRenderer } from '../renderers/measuring-instrument-loan-inspection/measuring-instrument-loan-inspection-renderer.js';

describe('MeasuringInstrumentLoanInspectionRenderer', () => {
  it('renders JPEG buffer for valid table data', async () => {
    const renderer = new MeasuringInstrumentLoanInspectionRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['従業員名', '貸出中計測機器数', '計測機器名称一覧'],
        rows: [
          { 従業員名: '山田 太郎', 点検件数: 2, 貸出中計測機器数: 2, 計測機器名称一覧: 'デジタルノギス, マイクロメータ' },
          { 従業員名: '佐藤 花子', 点検件数: 0, 貸出中計測機器数: 1, 計測機器名称一覧: 'トルクレンチ' },
        ],
        metadata: {
          targetDate: '2026-02-25',
          totalUsers: 2,
          inspectedUsers: 1,
        },
      },
      { width: 1280, height: 720, title: '計測機器持出状況（点検可視化）' },
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });

  it('renders error message when metadata.error exists', async () => {
    const renderer = new MeasuringInstrumentLoanInspectionRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['従業員名', '貸出中計測機器数', '計測機器名称一覧'],
        rows: [],
        metadata: { error: 'sectionEquals is required' },
      },
      { width: 800, height: 450 },
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });
});
