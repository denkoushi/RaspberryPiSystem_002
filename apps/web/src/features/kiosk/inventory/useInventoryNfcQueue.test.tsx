import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveInventoryTag } from '../../../api/client';

import { playInventoryTone } from './inventoryPageModel';
import { useInventoryNfcQueue } from './useInventoryNfcQueue';

vi.mock('../../../api/client', () => ({ resolveInventoryTag: vi.fn() }));
const outbox = vi.hoisted(() => ({ save: vi.fn(), hasPending: vi.fn(), flush: vi.fn() }));
vi.mock('./offline/useInventoryOfflineQueue', () => ({ useInventoryOfflineQueue: () => outbox }));
vi.mock('./inventoryPageModel', async importOriginal => ({
  ...await importOriginal<typeof import('./inventoryPageModel')>(), playInventoryTone: vi.fn(),
}));
beforeEach(() => { vi.resetAllMocks(); outbox.hasPending.mockResolvedValue(false); outbox.flush.mockResolvedValue(undefined); outbox.save.mockResolvedValue([{ status: 'pending' }]); });
const retryError = (status?: number) => ({ isAxiosError: true, response: status ? { status } : undefined });
function mountMovement(touch = false, restock = false) {
  const options = {
    canIssue: () => true, machineRef: { current: 'machine' }, editingRef: { current: false },
    selectMachine: vi.fn(), drainEventsRef: { current: async () => {} }, drainingRef: { current: false },
    flowRef: { current: { processing: false, restockMode: restock, restockTagUid: restock ? 'restock-tag' : null,
      selectedTag: { uid: touch ? '' : 'item', compartment: { id: 'drawer', stockQuantity: 10 } } } },
    eventQueueRef: { current: [{ uid: 'quantity', timestamp: 'now', eventId: 'scan-1',
      inventoryTag: { kind: 'QUANTITY', uid: 'quantity', quantity: 3 }, inventoryTagFromCache: true }] },
    queryClient: { invalidateQueries: vi.fn() }, mountedRef: { current: true },
    setMessage: vi.fn(), setMessageKind: vi.fn(), setPanel: vi.fn(), selectTag: vi.fn(),
    setRestockMode: vi.fn(), setQuantityError: vi.fn(), setLastTransaction: vi.fn(),
    selectionVerificationRef: { current: null }, verificationGenerationRef: { current: 0 },
    setRefreshingTag: vi.fn(),
    runOperation: vi.fn(async (operation: () => Promise<boolean>, onError: (error: unknown) => Promise<void> | void) => {
      try { return await operation(); } catch (error) { await onError(error); return false; }
    }),
    mutations: { transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: vi.fn() } },
    completeMovement: vi.fn(), handleTouchError: vi.fn(),
  };
  renderHook(() => useInventoryNfcQueue(options as never));
  return options;
}

describe('useInventoryNfcQueue', () => {
  it.each([false, true])('uses the latest canIssue after a pending lookup, allowed=%s', async allowed => {
    let resolveLookup!: (tag: unknown) => void;
    vi.mocked(resolveInventoryTag).mockReturnValue(new Promise(resolve => { resolveLookup = resolve; }) as never);
    const drainEventsRef = { current: async () => {} };
    const runOperation = vi.fn().mockResolvedValue(undefined);
    const options = {
      drainEventsRef, runOperation,
      drainingRef: { current: false }, flowRef: { current: { processing: false } },
      eventQueueRef: { current: [{ uid: 'quantity', timestamp: 'now' }] },
      mountedRef: { current: true }, setPanel: vi.fn(),
    };
    const { rerender } = renderHook(({ canIssue }) => useInventoryNfcQueue({
      ...options, canIssue,
    } as never), { initialProps: { canIssue: () => !allowed } });
    let draining!: Promise<void>;
    act(() => { draining = drainEventsRef.current(); });
    rerender({ canIssue: () => allowed });
    await act(async () => {
      resolveLookup({ kind: 'QUANTITY', uid: 'quantity', quantity: 1 });
      await draining;
    });
    expect(runOperation).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
  it.each([undefined, 408, 429, 500, 503])('queues transient transaction failures (%s) with a success tone', async status => {
    const options = mountMovement();
    options.mutations.transaction.mutateAsync.mockRejectedValue(retryError(status));
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save).toHaveBeenCalledWith({ display: { itemName: undefined, quantity: 3, restock: false }, route: 'transaction', createdAt: expect.any(String),
      body: { itemTagUid: 'item', expectedCompartmentId: 'drawer', quantityTagUid: 'quantity', restock: false,
        restockTagUid: undefined, machineId: 'machine', idempotencyKey: 'nfc-scan-1' } });
    expect(options.setMessage).toHaveBeenLastCalledWith('未送信 1 件');
    expect(options.setMessageKind).toHaveBeenLastCalledWith('success');
    expect(playInventoryTone).toHaveBeenCalledExactlyOnceWith('success');
    expect(options.completeMovement).not.toHaveBeenCalled();
    await expect(options.runOperation.mock.results[0].value).resolves.toBe(true);
  });
  it.each([false, true])('queues cached touch quantity after resolve fails, restock=%s', async restock => {
    const options = mountMovement(true, restock);
    outbox.hasPending.mockResolvedValue(true);
    vi.mocked(resolveInventoryTag).mockRejectedValue(retryError(503));
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save).toHaveBeenCalledWith({ display: { itemName: undefined, quantity: 3, restock }, route: 'touchTransaction', createdAt: expect.any(String),
      body: { compartmentId: 'drawer', quantity: 3, restock, machineId: restock ? undefined : 'machine', idempotencyKey: 'nfc-scan-1' } });
    expect(options.mutations.touchTransaction.mutateAsync).not.toHaveBeenCalled();
    expect(options.handleTouchError).not.toHaveBeenCalled();
    expect(outbox.flush).toHaveBeenCalledOnce();
    expect(playInventoryTone).toHaveBeenCalledExactlyOnceWith('success');
  });
  it.each([false, true])('prefers the UUID eventKey for online and queued requests, touch=%s', async touch => {
    const options = mountMovement(touch);
    const eventKey = '12345678-1234-4234-8234-123456789abc';
    Object.assign(options.eventQueueRef.current[0], { eventKey });
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'QUANTITY', quantity: 3 } as never);
    const mutation = touch ? options.mutations.touchTransaction : options.mutations.transaction;
    mutation.mutateAsync.mockRejectedValue(retryError());
    outbox.save.mockResolvedValue([{ status: 'pending' }, { status: 'failed' }]);
    await act(async () => { await options.drainEventsRef.current(); });
    expect(mutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `nfc-${eventKey}` }));
    expect(outbox.save.mock.calls[0][0].body.idempotencyKey).toBe(`nfc-${eventKey}`);
    expect(`nfc-${eventKey}`).toHaveLength(40);
    expect(options.setMessage).toHaveBeenLastCalledWith('未送信 1 件・失敗 1 件');
    expect(playInventoryTone).toHaveBeenCalledExactlyOnceWith('success');
  });
  it('falls back to uid and timestamp when both event identifiers are absent', async () => {
    const options = mountMovement();
    Object.assign(options.eventQueueRef.current[0], { eventId: undefined });
    options.mutations.transaction.mutateAsync.mockRejectedValue(retryError());
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save.mock.calls[0][0].body.idempotencyKey).toBe('nfc-quantity-now');
  });
  it('uses the latest touch quantity and drops expectedBeforeQuantity only from the saved request', async () => {
    const options = mountMovement(true);
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'QUANTITY', quantity: 5 } as never);
    options.mutations.touchTransaction.mutateAsync.mockRejectedValue(retryError());
    await act(async () => { await options.drainEventsRef.current(); });
    expect(options.mutations.touchTransaction.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5, expectedBeforeQuantity: 10 }));
    expect(outbox.save.mock.calls[0][0].body).toEqual({ compartmentId: 'drawer', quantity: 5, restock: false, machineId: 'machine', idempotencyKey: 'nfc-scan-1' });
  });
  it.each([400, 404, 409, 422])('keeps permanent %s failures on the existing error path', async status => {
    const options = mountMovement();
    options.mutations.transaction.mutateAsync.mockRejectedValue(retryError(status));
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save).not.toHaveBeenCalled();
    expect(options.setMessageKind).toHaveBeenCalledWith('error');
    expect(playInventoryTone).toHaveBeenCalledWith('error');
  });
  it.each(['送信待ちが上限です', '保存できません'])('reports failed queue saves: %s', async message => {
    const options = mountMovement();
    options.mutations.transaction.mutateAsync.mockRejectedValue(retryError());
    outbox.save.mockRejectedValue(new Error(message));
    await act(async () => { await options.drainEventsRef.current(); });
    expect(options.setMessage).toHaveBeenLastCalledWith(message);
    expect(options.setMessageKind).toHaveBeenLastCalledWith('error');
    expect(playInventoryTone).toHaveBeenCalledWith('error');
  });
  it('does not queue touch lookups rejected permanently', async () => {
    const options = mountMovement(true);
    vi.mocked(resolveInventoryTag).mockRejectedValue(retryError(404));
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save).not.toHaveBeenCalled();
    expect(options.handleTouchError).toHaveBeenCalled();
  });
  it.each([false, true])('queues behind pending requests and starts a flush, touch=%s', async touch => {
    const options = mountMovement(touch);
    vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'QUANTITY', quantity: 3 } as never);
    outbox.hasPending.mockResolvedValue(true);
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save).toHaveBeenCalledOnce();
    expect(outbox.flush).toHaveBeenCalledOnce();
    expect(options.mutations.transaction.mutateAsync).not.toHaveBeenCalled();
    expect(options.mutations.touchTransaction.mutateAsync).not.toHaveBeenCalled();
  });
  it.each([false, true])('preserves the queue cap message on touch, lookupFailure=%s', async lookupFailure => {
    const options = mountMovement(true);
    if (lookupFailure) vi.mocked(resolveInventoryTag).mockRejectedValue(retryError());
    else {
      vi.mocked(resolveInventoryTag).mockResolvedValue({ kind: 'QUANTITY', quantity: 3 } as never);
      options.mutations.touchTransaction.mutateAsync.mockRejectedValue(retryError());
    }
    outbox.save.mockRejectedValue(new Error('送信待ちが上限です'));
    await act(async () => { await options.drainEventsRef.current(); });
    expect(options.setMessage).toHaveBeenLastCalledWith('送信待ちが上限です');
    expect(options.handleTouchError).not.toHaveBeenCalled();
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])('saves without changing stale UI, lookupFailure=%s generationChanged=%s', async (lookupFailure, generationChanged) => {
    const options = mountMovement(lookupFailure);
    if (lookupFailure) vi.mocked(resolveInventoryTag).mockRejectedValue(retryError());
    else options.mutations.transaction.mutateAsync.mockRejectedValue(retryError());
    outbox.save.mockImplementation(async () => {
      if (generationChanged) options.verificationGenerationRef.current++;
      else options.mountedRef.current = false;
      return [{ status: 'pending' }];
    });
    await act(async () => { await options.drainEventsRef.current(); });
    expect(outbox.save).toHaveBeenCalledOnce();
    expect(options.setMessage).not.toHaveBeenCalled();
    expect(options.setLastTransaction).not.toHaveBeenCalled();
    expect(options.setRestockMode).not.toHaveBeenCalled();
    expect(playInventoryTone).not.toHaveBeenCalled();
  });
  it('leaves successful online movements on the existing completion path', async () => {
    const options = mountMovement(false, true);
    const transaction = { id: 'sent' };
    options.mutations.transaction.mutateAsync.mockResolvedValue({ transaction });
    await act(async () => { await options.drainEventsRef.current(); });
    expect(options.completeMovement).toHaveBeenCalledWith(transaction, true);
    expect(outbox.save).not.toHaveBeenCalled();
  });

});
