import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { usePalletOutboxReplay } from './usePalletOutboxReplay';

const mocks = vi.hoisted(() => ({ flush: vi.fn(async () => {}), invalidateQueries: vi.fn(), off: vi.fn(), sent: undefined as (() => void) | undefined }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));
vi.mock('./palletOutboxRunner', () => ({ palletOutboxRunner: { flush: mocks.flush, onSent: (listener: () => void) => { mocks.sent = listener; return mocks.off; } } }));
it('replays on mount, online and timer and invalidates all kiosk boards after success', () => {
  vi.useFakeTimers();
  try {
    const { unmount } = renderHook(usePalletOutboxReplay);
    expect(mocks.flush).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(30_000);
    expect(mocks.flush).toHaveBeenCalledTimes(3);
    mocks.sent?.();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['kiosk-pallet-viz-board'] });
    unmount();
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(30_000);
    expect(mocks.flush).toHaveBeenCalledTimes(3);
    expect(mocks.off).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
