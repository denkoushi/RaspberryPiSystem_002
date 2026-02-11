import { describe, expect, it } from 'vitest';
import { UninspectedMachinesRenderer } from '../renderers/uninspected-machines/uninspected-machines-renderer.js';

describe('UninspectedMachinesRenderer', () => {
  it('renders JPEG buffer for valid table data', async () => {
    const renderer = new UninspectedMachinesRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['設備管理番号', '加工機名称'],
        rows: [
          { 設備管理番号: 'M-001', 加工機名称: '加工機A' },
          { 設備管理番号: 'M-002', 加工機名称: '加工機B' },
        ],
        metadata: {
          date: '2026-02-11',
          totalRunningMachines: 10,
          inspectedRunningCount: 8,
          uninspectedCount: 2,
        },
      },
      { width: 1280, height: 720, title: '未点検加工機' },
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });

  it('renders error message when metadata.error exists', async () => {
    const renderer = new UninspectedMachinesRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['設備管理番号'],
        rows: [],
        metadata: { error: 'csvDashboardId is required' },
      },
      { width: 800, height: 450 },
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });
});

