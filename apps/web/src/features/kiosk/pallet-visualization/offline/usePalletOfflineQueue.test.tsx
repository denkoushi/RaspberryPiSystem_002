import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePalletOfflineQueue } from './usePalletOfflineQueue';

import type { PalletQueueRecord } from './palletOfflineQueueStore';

const state = vi.hoisted(() => ({ listener: undefined as ((records: PalletQueueRecord[], failure?: string) => void) | undefined, sent: undefined as (() => void) | undefined, off: vi.fn(), offSent: vi.fn() }));
vi.mock('./palletOutboxRunner', () => ({ palletOutboxRunner: {
  submit: vi.fn(), refresh: vi.fn(async () => {}),
  subscribe: (listener: typeof state.listener) => { state.listener = listener; return state.off; },
  onSent: (listener: typeof state.sent) => { state.sent = listener; return state.offSent; },
} }));
const record: PalletQueueRecord = { route: 'add', machineCd: 'MC', palletNo: 1, sequence: 1, body: { machineCd: 'MC', palletNo: 1, manufacturingOrderBarcodeRaw: 'ORDER', eventKey: 'key', readAt: '2026-11-03T09:00:00Z' }, eventKey: 'key', readAt: '2026-11-03T09:00:00Z', status: 'pending' };
function Message() { const { message } = usePalletOfflineQueue(); return message ? <p role="status">{message}</p> : null; }
beforeEach(() => vi.clearAllMocks());
it('displays pending counts and clears the message after acknowledgement', () => {
  const view = render(<Message />);
  act(() => state.listener?.([record, { ...record, eventKey: 'key2' }]));
  expect(screen.getByRole('status')).toHaveTextContent('未送信 2 件');
  act(() => state.listener?.([record]));
  expect(screen.getByRole('status')).toHaveTextContent('未送信 1 件');
  act(() => state.listener?.([]));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  view.unmount();
  expect(state.off).toHaveBeenCalledOnce();
  expect(state.offSent).toHaveBeenCalledOnce();
});
it('surfaces permanent replay failures in the existing message', () => {
  render(<Message />);
  act(() => {
    state.listener?.([record], 'タグ未登録');
    state.listener?.([]);
  });
  expect(screen.getByRole('status')).toHaveTextContent('未送信 0 件・タグ未登録');
  act(() => state.listener?.([record]));
  expect(screen.getByRole('status')).toHaveTextContent('未送信 1 件・タグ未登録');
  act(() => {
    state.sent?.();
    state.listener?.([]);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
