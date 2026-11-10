import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { autoUnitSplitKioskSessakuPieces } from '../../../../api/domains/production-schedule/grinding-planning-board';
import { productionScheduleQueryKeys } from '../../../../api/queryKeys/productionSchedule';
import { usePlanningBoardAutoUnitSplit } from '../usePlanningBoardAutoUnitSplit';

import type { SessakuPiecesAutoUnitSplitResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

vi.mock('../../../../api/domains/production-schedule/grinding-planning-board', () => ({ autoUnitSplitKioskSessakuPieces: vi.fn() }));
const call = vi.mocked(autoUnitSplitKioskSessakuPieces);
const response = (splitCount = 0, hasMore = true) => ({ splitCount, hasMore, skippedCount: 0 });
function setup(strict = false, isBusy?: () => boolean) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{strict ? <StrictMode>{children}</StrictMode> : children}</QueryClientProvider>;
  return { ...renderHook(() => usePlanningBoardAutoUnitSplit(isBusy), { wrapper }), invalidate };
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); call.mockReset().mockResolvedValue(response()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('usePlanningBoardAutoUnitSplit', () => {
  it('spaces requests by at least three seconds and stops at ten, including StrictMode', async () => {
    setup(true);
    await advance(2999); expect(call).not.toHaveBeenCalled();
    await advance(1); expect(call).toHaveBeenCalledTimes(1);
    await advance(2999); expect(call).toHaveBeenCalledTimes(1);
    await advance(27001); expect(call).toHaveBeenCalledTimes(10);
    await advance(60000); expect(call).toHaveBeenCalledTimes(10);
  });
  it('stops on hasMore=false and invalidates only after splitCount>0', async () => {
    call.mockResolvedValueOnce(response(0)).mockResolvedValueOnce(response(2)).mockResolvedValueOnce(response(0, false));
    const h = setup();
    await advance(3000); expect(h.invalidate).not.toHaveBeenCalled();
    await advance(3000); expect(h.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    await advance(60000); expect(call).toHaveBeenCalledTimes(3); expect(h.invalidate).toHaveBeenCalledTimes(1);
  });
  it('cancels its waiting timer on unmount', async () => {
    const h = setup(); h.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await advance(60000); expect(call).not.toHaveBeenCalled();
  });
  it('ignores responses arriving after unmount', async () => {
    let finish!: (result: SessakuPiecesAutoUnitSplitResponse) => void;
    call.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const h = setup(); await advance(3000); h.unmount();
    await act(async () => { finish(response(2)); });
    expect(h.invalidate).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('never overlaps a pending request', async () => {
    let finish!: (result: SessakuPiecesAutoUnitSplitResponse) => void;
    call.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    setup(); await advance(30000); expect(call).toHaveBeenCalledTimes(1);
    await act(async () => { finish(response()); });
    await advance(2999); expect(call).toHaveBeenCalledTimes(1);
    await advance(1); expect(call).toHaveBeenCalledTimes(2);
  });
  it('backs off failures and counts failed attempts against the limit', async () => {
    call.mockRejectedValue(new Error('offline'));
    setup(); await advance(3000); expect(call).toHaveBeenCalledTimes(1);
    await advance(5999); expect(call).toHaveBeenCalledTimes(1);
    await advance(1); expect(call).toHaveBeenCalledTimes(2);
    await advance(11999); expect(call).toHaveBeenCalledTimes(2);
    await advance(1); expect(call).toHaveBeenCalledTimes(3);
    await advance(600000); expect(call).toHaveBeenCalledTimes(10);
  });
  it('does not call or consume attempts offline and resumes on the next interval', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup(); await advance(60000); expect(call).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    await advance(30000); expect(call).toHaveBeenCalledTimes(10);
  });
  it('defers without consuming attempts while the user is saving and resumes afterwards', async () => {
    let busy = true;
    setup(false, () => busy); await advance(60000); expect(call).not.toHaveBeenCalled();
    busy = false;
    await advance(3000); expect(call).toHaveBeenCalledTimes(1);
    await advance(27000); expect(call).toHaveBeenCalledTimes(10);
  });
});
