import { describe, expect, it } from 'vitest';
import { KpiCardsRenderer } from '../renderers/kpi-cards/kpi-cards-renderer.js';

describe('KpiCardsRenderer', () => {
  it('should render KPI cards to jpeg buffer', async () => {
    const renderer = new KpiCardsRenderer();
    const output = await renderer.render(
      {
        kind: 'kpi',
        items: [
          { label: '期限内返却率', value: 92, unit: '%', isGood: true, note: '92/100' },
          { label: '期限超過率', value: 8, unit: '%', isGood: false, note: '8/100' },
        ],
      },
      { width: 800, height: 450, title: 'Test KPI' }
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });

  it('replaces invalid stored colors with defaults and accepts valid hex colors', async () => {
    const renderer = new KpiCardsRenderer();
    const data = { kind: 'kpi' as const, items: [{ label: 'A', value: 5, isGood: true }, { label: 'B', value: 2, isGood: false }, { label: 'C', value: 3 }] };
    const config = { width: 800, height: 450 };
    const defaults = await renderer.render(data, config);
    const invalid = await renderer.render(data, { ...config, colors: { good: '"/><image href="http://example.com/', bad: 'red', neutral: 'url(http://example.com)' } });
    expect(invalid.buffer).toEqual(defaults.buffer);
    const valid = await renderer.render(data, { ...config, colors: { good: '#123456', bad: '#abcdef', neutral: '#112233' } });
    expect(valid.contentType).toBe('image/jpeg');
    expect(valid.buffer).not.toEqual(defaults.buffer);
  });
});
