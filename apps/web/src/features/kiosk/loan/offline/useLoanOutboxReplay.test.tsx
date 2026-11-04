import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLoanOutboxReplay } from './useLoanOutboxReplay';

import type { ReactNode } from 'react';

const runner = vi.hoisted(() => ({
  sentListeners: new Set<() => void>(),
  flush: vi.fn(async () => {}),
  off: vi.fn(),
}));
vi.mock('./loanOutboxRunner', () => ({
  loanOutboxRunner: {
    flush: runner.flush,
    onSent: (listener: () => void) => {
      runner.sentListeners.add(listener);
      return () => {
        runner.off();
        runner.sentListeners.delete(listener);
      };
    },
  },
}));

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidate, ...renderHook(() => useLoanOutboxReplay(), { wrapper }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  runner.sentListeners.clear();
  runner.flush.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('useLoanOutboxReplay', () => {
  it('マウント直後に1回 flush し、その後 30 秒ごとに再送する', () => {
    setup();
    expect(runner.flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(29_999);
    expect(runner.flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(runner.flush).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(runner.flush).toHaveBeenCalledTimes(4);
  });

  it('online イベントで即時に flush する', () => {
    setup();
    window.dispatchEvent(new Event('online'));
    expect(runner.flush).toHaveBeenCalledTimes(2);
  });

  it('送信成功の通知で貸出一覧クエリを無効化する', () => {
    const { invalidate } = setup();
    expect(invalidate).not.toHaveBeenCalled();
    runner.sentListeners.forEach(listener => listener());
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['loans'] });
  });

  it('flush の失敗は握りつぶさず warn に出し、例外を外へ投げない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('replay failed');
    runner.flush.mockRejectedValueOnce(error);
    setup();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Loan offline replay failed', error));
    warn.mockRestore();
  });

  it('アンマウントで購読・タイマー・online リスナーを解除する', () => {
    const { unmount } = setup();
    unmount();
    expect(runner.off).toHaveBeenCalledOnce();
    expect(runner.sentListeners.size).toBe(0);
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('online'));
    expect(runner.flush).toHaveBeenCalledTimes(1);
  });
});
