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
});
