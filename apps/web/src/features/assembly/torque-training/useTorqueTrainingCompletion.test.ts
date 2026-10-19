import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTorqueTrainingCompletion } from './useTorqueTrainingCompletion';

describe('useTorqueTrainingCompletion', () => {
  it('completes the UI when the heartbeat already cleared the local lease', () => {
    const releaseLocalLease = vi.fn().mockResolvedValue({});
    const onCompleted = vi.fn();
    const { rerender } = renderHook(
      ({ status, hasLocalLease }) => useTorqueTrainingCompletion({
        sessionId: 'session-1',
        status,
        hasLocalLease,
        releaseLocalLease,
        onCompleted
      }),
      { initialProps: { status: 'IN_PROGRESS' as const, hasLocalLease: true } }
    );

    rerender({ status: 'IN_PROGRESS', hasLocalLease: false });
    rerender({ status: 'COMPLETED', hasLocalLease: false });

    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(releaseLocalLease).not.toHaveBeenCalled();
  });

  it('releases a retained local lease and handles each completed session once', () => {
    const releaseLocalLease = vi.fn().mockResolvedValue({});
    const onCompleted = vi.fn();
    const { rerender } = renderHook(
      ({ sessionId }) => useTorqueTrainingCompletion({
        sessionId,
        status: 'COMPLETED',
        hasLocalLease: true,
        releaseLocalLease,
        onCompleted
      }),
      { initialProps: { sessionId: 'session-1' } }
    );

    rerender({ sessionId: 'session-1' });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(releaseLocalLease).toHaveBeenCalledTimes(1);
    expect(releaseLocalLease).toHaveBeenCalledWith('TRAINING_COMPLETED');

    rerender({ sessionId: 'session-2' });
    expect(onCompleted).toHaveBeenCalledTimes(2);
    expect(releaseLocalLease).toHaveBeenCalledTimes(2);
  });
});
