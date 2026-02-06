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

  it('should render up to 20 items with reduced card height', async () => {
    const renderer = new ProgressListRenderer();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      FSEIBAN: `TEST${String(i + 1).padStart(4, '0')}`,
      INCOMPLETE_PARTS: i % 2 === 0 ? '' : '部品A, 部品B',
      completed: i % 2 === 0 ? 5 : 3,
      total: 5,
      percent: i % 2 === 0 ? 100 : 60,
      status: i % 2 === 0 ? '完了' : '未完了',
    }));

    const output = await renderer.render(
      {
        kind: 'table',
        columns: ['FSEIBAN', 'INCOMPLETE_PARTS', 'completed', 'total', 'percent', 'status'],
        rows,
      },
      { width: 1920, height: 1080, title: '生産進捗' }
    );

    expect(output.contentType).toBe('image/jpeg');
    expect(output.buffer.length).toBeGreaterThan(0);
  });
});
