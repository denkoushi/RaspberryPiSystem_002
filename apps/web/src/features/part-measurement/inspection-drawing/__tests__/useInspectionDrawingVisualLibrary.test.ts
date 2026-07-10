import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listPartMeasurementVisualTemplates } from '../../../../api/client';
import { useInspectionDrawingVisualLibrary } from '../useInspectionDrawingVisualLibrary';

vi.mock('../../../../api/client', () => ({
  listPartMeasurementVisualTemplates: vi.fn()
}));

const listVisualsMock = vi.mocked(listPartMeasurementVisualTemplates);

function visual(index: number) {
  return {
    id: `visual-${index}`,
    name: `図面-${index}`,
    drawingImageRelativePath: `/api/storage/part-measurement-drawings/${index}.png`,
    isActive: true,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  };
}

describe('useInspectionDrawingVisualLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listVisualsMock.mockResolvedValue([]);
  });

  it('does not call list API when disabled for preview', async () => {
    renderHook(() => useInspectionDrawingVisualLibrary({ enabled: false }));

    await waitFor(() => {
      expect(listPartMeasurementVisualTemplates).not.toHaveBeenCalled();
    });
  });

  it('searches server-side by drawing-name digits and exposes a 40-row cap', async () => {
    listVisualsMock.mockResolvedValue(Array.from({ length: 41 }, (_, index) => visual(index)));
    const { result } = renderHook(() => useInspectionDrawingVisualLibrary({ digitQuery: '7161' }));

    await waitFor(() => {
      expect(listVisualsMock).toHaveBeenCalledWith(
        {
          q: undefined,
          digitQuery: '7161',
          limit: 41,
          sort: 'recentlyUpdated'
        },
        undefined
      );
    });
    await waitFor(() => expect(result.current.visuals).toHaveLength(40));
    expect(result.current.hasMore).toBe(true);
  });
});
