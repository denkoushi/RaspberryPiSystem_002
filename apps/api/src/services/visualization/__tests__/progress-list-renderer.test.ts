import { describe, expect, it } from 'vitest';
import { ProgressListRenderer } from '../renderers/progress-list/progress-list-renderer.js';

describe('ProgressListRenderer', () => {
  it('should render progress list to jpeg buffer', async () => {
    const renderer = new ProgressListRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['FSEIBAN', 'FHINMEI', 'ProductNo', 'completed', 'total', 'percent', 'status'],
        rows: [
          {
            FSEIBAN: 'ABC12345',
            FHINMEI: '製品A',
            ProductNo: '2024001',
            completed: 5,
            total: 5,
            percent: 100,
            status: '完了',
          },
          {
            FSEIBAN: 'DEF67890',
            FHINMEI: '製品B',
            ProductNo: '2024002',
            completed: 3,
            total: 5,
            percent: 60,
            status: '未完了',
          },
        ],
      },
      { width: 800, height: 450, title: 'Test Progress' }
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });
});
