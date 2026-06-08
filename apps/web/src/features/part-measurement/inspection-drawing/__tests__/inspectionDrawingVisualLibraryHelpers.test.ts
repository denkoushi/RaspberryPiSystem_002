import { describe, expect, it, vi } from 'vitest';

import { getPartMeasurementVisualTemplate } from '../../../../api/client';
import {
  defaultVisualNameFromFileName,
  formatVisualLibraryTimestamp,
  resolveVisualTemplateById
} from '../inspectionDrawingVisualLibraryHelpers';

vi.mock('../../../../api/client', () => ({
  getPartMeasurementVisualTemplate: vi.fn()
}));

describe('inspectionDrawingVisualLibraryHelpers', () => {
  it('defaultVisualNameFromFileName strips extension', () => {
    expect(defaultVisualNameFromFileName('sample-drawing.pdf')).toBe('sample-drawing');
    expect(defaultVisualNameFromFileName('.hidden')).toBe('図面テンプレート');
  });

  it('formatVisualLibraryTimestamp returns ja-JP label', () => {
    const label = formatVisualLibraryTimestamp('2026-06-08T03:00:00.000Z');
    expect(label).not.toBe('—');
    expect(label).toMatch(/\d/);
  });

  it('resolveVisualTemplateById fetches visual by id', async () => {
    vi.mocked(getPartMeasurementVisualTemplate).mockResolvedValue({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: '図面A',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/a.png',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });

    const visual = await resolveVisualTemplateById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(visual?.name).toBe('図面A');
    expect(getPartMeasurementVisualTemplate).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      undefined
    );
  });
});
