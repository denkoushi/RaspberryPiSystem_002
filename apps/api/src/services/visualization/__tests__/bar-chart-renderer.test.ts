import { describe, expect, it } from 'vitest';
import { BarChartRenderer } from '../renderers/bar-chart/bar-chart-renderer.js';

describe('BarChartRenderer', () => {
  it('should render bar chart to jpeg buffer', async () => {
    const renderer = new BarChartRenderer();
    const output = await renderer.render(
      {
        kind: 'series',
        labels: ['A', 'B', 'C'],
        datasets: [
          {
            label: '使用回数',
            values: [10, 7, 3],
          },
        ],
      },
      { width: 800, height: 450, title: 'Test Chart' }
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });
});
