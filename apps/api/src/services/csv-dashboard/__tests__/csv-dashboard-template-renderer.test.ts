import { describe, expect, it } from 'vitest';
import { CsvDashboardTemplateRenderer } from '../csv-dashboard-template-renderer.js';
import type { NormalizedRowData, TableTemplateConfig } from '../csv-dashboard.types.js';

const columnDefinitions = [
  { internalName: 'colA', displayName: '列A', dataType: 'string' },
  { internalName: 'colB', displayName: '列B', dataType: 'string' }
];

const baseConfig: TableTemplateConfig = {
  rowsPerPage: 10,
  fontSize: 14,
  displayColumns: ['colA', 'colB']
};

const extractHeaderWidths = (svg: string): number[] => {
  const widths: number[] = [];
  const regex = /<rect x="(\d+)" y="0" width="(\d+)" height="(\d+)" fill="#1e293b"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(svg)) !== null) {
    widths.push(Number(match[2]));
  }
  return widths;
};

describe('CsvDashboardTemplateRenderer renderTable', () => {
  it('does not stretch columns when required width is smaller than canvas', () => {
    const renderer = new CsvDashboardTemplateRenderer();
    const rows: NormalizedRowData[] = [
      { colA: 'A', colB: 'B' },
      { colA: 'AA', colB: 'BB' }
    ];

    const svg = renderer.renderTable(rows, columnDefinitions, baseConfig, 'Test', undefined, {
      canvasWidth: 1920,
      canvasHeight: 1080
    });

    const widths = extractHeaderWidths(svg);
    const total = widths.reduce((sum, w) => sum + w, 0);
    expect(widths.length).toBe(2);
    expect(total).toBeLessThan(1920);
  });

  it('shrinks columns to fit when required width exceeds canvas', () => {
    const renderer = new CsvDashboardTemplateRenderer();
    const rows: NormalizedRowData[] = [
      { colA: 'A'.repeat(80), colB: 'B'.repeat(40) }
    ];

    const svg = renderer.renderTable(rows, columnDefinitions, baseConfig, 'Test', undefined, {
      canvasWidth: 900,
      canvasHeight: 540
    });

    const widths = extractHeaderWidths(svg);
    const total = widths.reduce((sum, w) => sum + w, 0);
    expect(widths.length).toBe(2);
    expect(total).toBeLessThanOrEqual(900);
  });

  it('increases column width when font size grows', () => {
    const renderer = new CsvDashboardTemplateRenderer();
    const rows: NormalizedRowData[] = [{ colA: 'AAAAAAA', colB: 'B' }];

    const svgSmall = renderer.renderTable(rows, columnDefinitions, {
      ...baseConfig,
      fontSize: 14
    }, 'Test', undefined, {
      canvasWidth: 1920,
      canvasHeight: 1080
    });

    const svgLarge = renderer.renderTable(rows, columnDefinitions, {
      ...baseConfig,
      fontSize: 24
    }, 'Test', undefined, {
      canvasWidth: 1920,
      canvasHeight: 1080
    });

    const smallWidths = extractHeaderWidths(svgSmall);
    const largeWidths = extractHeaderWidths(svgLarge);
    expect(largeWidths[0]).toBeGreaterThan(smallWidths[0]);
  });

  it('uses max string across all rows (not only first page rows)', () => {
    const renderer = new CsvDashboardTemplateRenderer();
    const rows: NormalizedRowData[] = [
      { colA: 'A', colB: 'B' },
      { colA: 'AA', colB: 'BB' },
      // 画面に入らない位置に長い値（この列幅も追随させたい）
      { colA: 'A'.repeat(80), colB: 'B' }
    ];

    // canvasHeightを小さくして rowsPerPage が 1 になる状況を作る
    const svg = renderer.renderTable(rows, columnDefinitions, {
      ...baseConfig,
      rowsPerPage: 200
    }, 'Test', undefined, {
      canvasWidth: 900,
      canvasHeight: 140
    });

    const widths = extractHeaderWidths(svg);
    expect(widths.length).toBe(2);
    // 長い値があるcolAが、colBより十分広いこと
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });
});
