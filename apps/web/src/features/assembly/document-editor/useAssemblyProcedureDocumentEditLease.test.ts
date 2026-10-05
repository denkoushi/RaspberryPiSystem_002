import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock('../../../api/domains/assembly-edit-lease', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/domains/assembly-edit-lease')>(),
  acquireAssemblyProcedureDocumentEditLease: mocks.acquire,
  releaseAssemblyProcedureDocumentEditLease: mocks.release
}));

import { useAssemblyProcedureDocumentEditLease } from './useAssemblyProcedureDocumentEditLease';

const ownLease = { holderLabel: '端末 1', acquiredAt: '2026-10-06T03:00:00Z', heartbeatAt: '2026-10-06T03:00:00Z' };
const otherLease = { ...ownLease, holderLabel: '端末 2' };
const locked = { isAxiosError: true, response: { status: 409, data: { code: 'ASSEMBLY_PROCEDURE_EDIT_LOCKED', lease: otherLease } } };

function renderLease(enabled = true) {
  const onLost = vi.fn();
  const hook = renderHook(() => useAssemblyProcedureDocumentEditLease({ documentId: 'document-1', enabled, onLost }));
  return { ...hook, onLost };
}

describe('document editor edit lease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.acquire.mockResolvedValue({ lease: ownLease, mine: true, holderToken: 'session-token' });
    mocks.release.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('waits for authentication, then acquires and heartbeats every 30 seconds', async () => {
    const disabled = renderLease(false);
    expect(mocks.acquire).not.toHaveBeenCalled();
    disabled.unmount();
    const hook = renderLease();
    expect(hook.result.current.mine).toBe(false);
    await act(async () => undefined);
    expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('document-1', false, null);
    expect(hook.result.current.mine).toBe(true);
    await act(async () => vi.advanceTimersByTime(29_999));
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.acquire).toHaveBeenLastCalledWith('document-1', false, 'session-token');
    expect(hook.result.current.holderToken).toBe('session-token');
    await act(async () => hook.unmount());
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('document-1', 'session-token');
  });

  it('exposes another holder and takes over only on an explicit request', async () => {
    mocks.acquire.mockRejectedValueOnce(locked);
    const hook = renderLease();
    await act(async () => undefined);
    expect(hook.result.current.mine).toBe(false);
    expect(hook.result.current.lease).toEqual(otherLease);
    expect(hook.onLost).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.takeover());
    expect(mocks.acquire).toHaveBeenLastCalledWith('document-1', true, null);
    expect(hook.result.current.mine).toBe(true);
    hook.unmount();
  });

  it('reports takeover on a heartbeat and stops writing heartbeats after losing the lease', async () => {
    const hook = renderLease();
    await act(async () => undefined);
    mocks.acquire.mockRejectedValueOnce(locked);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(hook.onLost).toHaveBeenCalledExactlyOnceWith(otherLease);
    expect(hook.result.current.mine).toBe(false);
    expect(hook.result.current.lease).toEqual(otherLease);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    hook.unmount();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each([
    ['not found', { isAxiosError: true, response: { status: 404 } }],
    ['server error', { isAxiosError: true, response: { status: 503 } }],
    ['network error', new Error('offline')]
  ])('retains ownership and retries heartbeats after %s', async (_label, error) => {
    const hook = renderLease();
    await act(async () => undefined);
    mocks.acquire.mockRejectedValueOnce(error);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(hook.result.current.mine).toBe(true);
    expect(hook.result.current.unavailable).toBe(true);
    expect(hook.result.current.holderToken).toBe('session-token');
    expect(hook.onLost).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(mocks.acquire).toHaveBeenLastCalledWith('document-1', false, 'session-token');
    expect(hook.result.current.unavailable).toBe(false);
    await act(async () => hook.unmount());
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('document-1', 'session-token');
  });

  it('releases once on pagehide and reacquires after a restored page', async () => {
    const hook = renderLease();
    await act(async () => undefined);
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(hook.result.current.mine).toBe(false);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('document-1', 'session-token');
    await act(async () => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(hook.result.current.mine).toBe(true);
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    await act(async () => hook.unmount());
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('releases an acquisition that completes after unmount', async () => {
    let resolve: (value: { lease: typeof ownLease; mine: boolean; holderToken: string }) => void = () => undefined;
    mocks.acquire.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const hook = renderLease();
    await act(async () => undefined);
    hook.unmount();
    await act(async () => resolve({ lease: ownLease, mine: true, holderToken: 'session-token' }));
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('document-1', 'session-token');
  });

  it('finishes the stale acquisition and release before reacquiring after reauthentication', async () => {
    let acquired: (value: { lease: typeof ownLease; mine: boolean; holderToken: string }) => void = () => undefined;
    let released: () => void = () => undefined;
    mocks.acquire.mockReturnValueOnce(new Promise((done) => { acquired = done; }));
    mocks.release.mockReturnValueOnce(new Promise<void>((done) => { released = done; }));
    const hook = renderHook(({ enabled }) => useAssemblyProcedureDocumentEditLease({
      documentId: 'document-1', enabled, onLost: vi.fn()
    }), { initialProps: { enabled: true } });
    await act(async () => undefined);
    hook.rerender({ enabled: false });
    hook.rerender({ enabled: true });
    await act(async () => acquired({ lease: ownLease, mine: true, holderToken: 'session-token' }));
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.acquire).toHaveBeenCalledTimes(1);
    await act(async () => released());
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(hook.result.current.mine).toBe(true);
    await act(async () => hook.unmount());
  });

  it.each([
    ['not found', { isAxiosError: true, response: { status: 404 } }],
    ['server error', { isAxiosError: true, response: { status: 503 } }],
    ['network error', new Error('offline')]
  ])('allows editing without a lease after %s and supports retry', async (_label, error) => {
    mocks.acquire.mockRejectedValueOnce(error);
    const hook = renderLease();
    await act(async () => undefined);
    expect(hook.result.current.mine).toBe(false);
    expect(hook.result.current.unavailable).toBe(true);
    expect(hook.result.current.lease).toBeNull();
    await act(async () => hook.result.current.retry());
    expect(hook.result.current.mine).toBe(true);
    expect(hook.result.current.unavailable).toBe(false);
    hook.unmount();
  });
});
