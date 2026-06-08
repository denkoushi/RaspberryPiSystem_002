import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { listPartMeasurementVisualTemplates } from '../../../../api/client';
import { useInspectionDrawingVisualLibrary } from '../useInspectionDrawingVisualLibrary';

vi.mock('../../../../api/client', () => ({
  listPartMeasurementVisualTemplates: vi.fn()
}));

describe('useInspectionDrawingVisualLibrary', () => {
  it('does not call list API when disabled for preview', async () => {
    renderHook(() => useInspectionDrawingVisualLibrary({ enabled: false }));

    await waitFor(() => {
      expect(listPartMeasurementVisualTemplates).not.toHaveBeenCalled();
    });
  });
});
