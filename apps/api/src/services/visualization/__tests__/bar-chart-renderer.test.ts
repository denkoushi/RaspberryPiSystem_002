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

  it('replaces invalid stored colors with defaults and accepts valid hex colors', async () => {
    const renderer = new BarChartRenderer();
    const data = { kind: 'series' as const, labels: ['A'], datasets: [{ label: 'A', values: [5] }] };
    const config = { width: 800, height: 450 };
    const defaults = await renderer.render(data, config);
    const invalid = await renderer.render(data, { ...config, colors: { good: '"/><image href="http://example.com/', bad: 'red', neutral: 'url(http://example.com)' } });
    expect(invalid.buffer).toEqual(defaults.buffer);
    const valid = await renderer.render(data, { ...config, colors: { good: '#123456', bad: '#abcdef', neutral: '#112233' } });
    expect(valid.contentType).toBe('image/jpeg');
    expect(valid.buffer).not.toEqual(defaults.buffer);
  });
});
