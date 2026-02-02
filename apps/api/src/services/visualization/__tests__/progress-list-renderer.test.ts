import { describe, expect, it } from 'vitest';
import { ProgressListRenderer } from '../renderers/progress-list/progress-list-renderer.js';

describe('ProgressListRenderer', () => {
  it('should render progress list to jpeg buffer', async () => {
    const renderer = new ProgressListRenderer();
    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['FSEIBAN', 'INCOMPLETE_PARTS', 'completed', 'total', 'percent', 'status'],
        rows: [
          {
            FSEIBAN: 'ABC12345',
            INCOMPLETE_PARTS: '',
            completed: 5,
            total: 5,
            percent: 100,
            status: '完了',
          },
          {
            FSEIBAN: 'DEF67890',
            INCOMPLETE_PARTS: '部品A, 部品B',
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
