import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSelfInspectionWorkbenchCameraExperiment } from '../useSelfInspectionWorkbenchCameraExperiment';

vi.mock('../../../utils/camera', () => ({
  getCameraStream: vi.fn(async () => ({
    getTracks: () => [{ stop: vi.fn() }]
  })),
  stopCameraStream: vi.fn()
}));

describe('useSelfInspectionWorkbenchCameraExperiment', () => {
  it('starts disabled and toggles enabled state', () => {
    const { result } = renderHook(() => useSelfInspectionWorkbenchCameraExperiment());
    expect(result.current.workbenchCameraEnabled).toBe(false);
    expect(result.current.workbenchCameraMetrics.successCount).toBe(0);

    act(() => {
      result.current.toggleWorkbenchCamera();
    });
    expect(result.current.workbenchCameraEnabled).toBe(true);

    act(() => {
      result.current.toggleWorkbenchCamera();
    });
    expect(result.current.workbenchCameraEnabled).toBe(false);
  });
});
