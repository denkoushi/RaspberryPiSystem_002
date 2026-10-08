import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useInventoryMutations, useInventoryTags } from '../../../../api/hooks';

import { InventoryTagsTab } from './InventoryTagsTab';
import { clearSetupPin } from './setupPinSession';

import type { NfcEvent } from '../../../../hooks/useNfcStream';

const nfc = vi.hoisted(() => ({ event: null as NfcEvent | null }));
vi.mock('../../../../api/hooks', () => ({
  useInventoryTags: vi.fn(() => ({ data: [
    { id: 'q1', uid: 'quantity-uid', kind: 'QUANTITY', quantity: 5, compartment: null },
    { id: 'r1', uid: 'restock-uid', kind: 'RESTOCK', quantity: null, compartment: null },
    { id: 'i1', uid: 'item-uid', kind: 'ITEM', quantity: null, compartment: null },
  ] })),
  useInventoryItems: vi.fn(() => ({ data: [] })),
  useInventoryMutations: vi.fn(),
}));
vi.mock('../../../../hooks/useNfcStream', () => ({
  useNfcStream: vi.fn((enabled: boolean) => enabled ? nfc.event : null),
}));
function mutation() { return { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }; }
function startQuantity(value = '3') {
  fireEvent.click(within(screen.getByRole('region', { name: '数量タグ' })).getByRole('button', { name: 'タグを追加' }));
  const keys = within(screen.getByRole('group', { name: '数量のテンキー' }));
  for (const digit of value) fireEvent.click(keys.getByRole('button', { name: digit, exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '次へ：タグをかざす' }));
}
function renderTab() {
  const view = render(<InventoryTagsTab accessPassword="2520" />);
  return { ...view, read: async (uid: string, eventId: number) => {
    nfc.event = { uid, eventId, timestamp: `2026-10-08T00:00:${eventId}Z` } as NfcEvent;
    await act(async () => { view.rerender(<InventoryTagsTab accessPassword="2520" />); });
  } };
}
describe('InventoryTagsTab', () => {
  let mutations: Record<string, ReturnType<typeof mutation>>;
  beforeEach(() => {
    nfc.event = null;
    mutations = { quantityTag: mutation(), restockTag: mutation(), replaceTag: mutation(), deleteTag: mutation() };
    vi.mocked(useInventoryMutations).mockReturnValue(mutations as never);
  });

  it.each([['quantity-uid', 'q1'], ['restock-uid', 'r1']])('deletes and recreates %s using its original values', async (uid, id) => {
    const view = renderTab();
    if (id === 'q1') fireEvent.click(screen.getByRole('button', { name: '数量5のタグ' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `タグ ${uid} を削除` })); });
    expect(mutations.deleteTag.mutateAsync).toHaveBeenCalledWith(id);
    expect(screen.queryByRole('button', { name: `タグ ${uid} を削除` })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); });
    if (id === 'q1') expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledWith({ uid, quantity: 5 });
    else expect(mutations.restockTag.mutateAsync).toHaveBeenCalledWith(uid);
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
    const original = vi.mocked(useInventoryTags).getMockImplementation()!;
    const current = original();
    vi.mocked(useInventoryTags).mockReturnValue({ data: current.data.map((tag) => tag.id === id ? { ...tag, id: `${id}-restored` } : tag) } as never);
    try {
      view.rerender(<InventoryTagsTab accessPassword="2520" />);
      expect(screen.getByRole('button', { name: `タグ ${uid} を削除` })).toBeInTheDocument();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: `タグ ${uid} を削除` })); });
      expect(mutations.deleteTag.mutateAsync).toHaveBeenLastCalledWith(`${id}-restored`);
    } finally { vi.mocked(useInventoryTags).mockImplementation(original); }
  });

  it('does not offer deletion of item tags', () => {
    renderTab();
    expect(screen.queryByRole('button', { name: 'タグ item-uid を削除' })).not.toBeInTheDocument();
  });

  it('reports failed deletion in the tag row and leaves it registered', async () => {
    mutations.deleteTag.mutateAsync.mockRejectedValue({ response: { data: { errorCode: 'TAG_CONFLICT', message: '削除できません' } } });
    renderTab();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'タグ restock-uid を削除' })); });
    expect(screen.getByRole('button', { name: 'タグ restock-uid を削除' }).closest('li')).toContainElement(screen.getByRole('alert'));
    expect(screen.getByRole('alert')).toHaveTextContent('削除できません');
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it('keeps waiting, counts successful registrations, changes quantity with one tap, and ignores duplicate UIDs', async () => {
    const view = renderTab();
    startQuantity();
    await view.read('a', 1);
    expect(mutations.quantityTag.mutateAsync).toHaveBeenLastCalledWith({ uid: 'a', quantity: 3 });
    expect(screen.getByText('登録 1件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '終わる' })).toBeInTheDocument();
    await view.read('a', 2);
    expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('group', { name: '次の数量' })).getByRole('button', { name: '5', exact: true }));
    await view.read('b', 3);
    expect(mutations.quantityTag.mutateAsync).toHaveBeenLastCalledWith({ uid: 'b', quantity: 5 });
    expect(screen.getByText('登録 2件')).toBeInTheDocument();
    await view.read('c', 4);
    expect(mutations.quantityTag.mutateAsync).toHaveBeenLastCalledWith({ uid: 'c', quantity: 5 });
    expect(screen.getByText('登録 3件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '終わる' }));
    await view.read('d', 5);
    expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledTimes(3);
    fireEvent.click(within(screen.getByRole('region', { name: '数量タグ' })).getByRole('button', { name: 'タグを追加' }));
    expect(screen.getByLabelText('数量')).toHaveTextContent('5');
  });

  it('does not count a failed registration and can retry the same UID', async () => {
    mutations.quantityTag.mutateAsync.mockRejectedValueOnce({ response: { data: { code: 'CONFLICT', message: '登録できません' } } });
    const view = renderTab();
    startQuantity();
    await view.read('a', 1);
    expect(screen.getByRole('region', { name: 'タグを読む' })).toContainElement(screen.getByRole('alert'));
    expect(screen.queryByText('登録 1件')).not.toBeInTheDocument();
    await view.read('a', 2);
    expect(screen.getByText('登録 1件')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks overlapping manual registration while the first request is pending', async () => {
    let finish!: (value: object) => void;
    mutations.quantityTag.mutateAsync.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderTab();
    startQuantity();
    fireEvent.click(screen.getByRole('button', { name: 'IDを手で入れる' }));
    fireEvent.change(screen.getByLabelText('タグのID'), { target: { value: 'manual' } });
    fireEvent.click(screen.getByRole('button', { name: '使う' }));
    fireEvent.click(screen.getByRole('button', { name: '使う' }));
    expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '終わる' })).toBeEnabled();
    await act(async () => { finish({}); });
    expect(screen.getByText('登録 1件')).toBeInTheDocument();
  });
  it('queues reads during a reply, deduplicates UIDs, and keeps the quantity from each read', async () => {
    let finish!: (value: object) => void;
    mutations.quantityTag.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderTab();
    startQuantity();
    await view.read('a', 1);
    fireEvent.click(within(screen.getByRole('group', { name: '次の数量' })).getByRole('button', { name: '5', exact: true }));
    await view.read('b', 2);
    await view.read('b', 3);
    fireEvent.click(within(screen.getByRole('group', { name: '次の数量' })).getByRole('button', { name: '10', exact: true }));
    expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => { finish({}); });
    expect(mutations.quantityTag.mutateAsync.mock.calls).toEqual([[{ uid: 'a', quantity: 3 }], [{ uid: 'b', quantity: 5 }]]);
    expect(screen.getByText('登録 2件')).toBeInTheDocument();
  });

  it('discards the remaining queue on failure and can read discarded UIDs again', async () => {
    let fail!: (error: unknown) => void;
    mutations.quantityTag.mutateAsync.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const view = renderTab();
    startQuantity();
    await view.read('a', 1);
    await view.read('b', 2);
    await view.read('c', 3);
    await act(async () => { fail(new Error('登録できません')); });
    expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'タグを読む' })).toContainElement(screen.getByRole('alert'));
    expect(screen.getByRole('alert')).toHaveTextContent('登録できません');
    await view.read('b', 4);
    expect(mutations.quantityTag.mutateAsync.mock.calls).toEqual([[{ uid: 'a', quantity: 3 }], [{ uid: 'b', quantity: 3 }]]);
    expect(screen.getByText('登録 1件')).toBeInTheDocument();
  });

  it.each(['finish', 'unmount', 'lock'])('discards waiting tags on %s', async (stop) => {
    let finish!: (value: object) => void;
    mutations.quantityTag.mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderTab();
    startQuantity();
    await view.read('a', 1);
    await view.read('b', 2);
    if (stop === 'finish') fireEvent.click(screen.getByRole('button', { name: '終わる' }));
    else if (stop === 'unmount') view.unmount();
    else act(clearSetupPin);
    await act(async () => { finish({}); });
    expect(mutations.quantityTag.mutateAsync).toHaveBeenCalledTimes(1);
    if (stop === 'finish') expect(screen.queryByRole('region', { name: 'タグを読む' })).not.toBeInTheDocument();
  });

});
