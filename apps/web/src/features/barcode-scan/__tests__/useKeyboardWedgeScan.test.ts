import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardWedgeScan } from '../useKeyboardWedgeScan';

const dispatchKey = (key: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('useKeyboardWedgeScan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('高速入力とEnterでスキャン確定する', () => {
    const onScan = vi.fn();

    renderHook(() =>
      useKeyboardWedgeScan({ active: true, onScan, minChars: 4, maxInterKeyDelayMs: 50, idleFlushMs: 120 })
    );

    act(() => {
      dispatchKey('1');
      vi.advanceTimersByTime(10);
      dispatchKey('2');
      vi.advanceTimersByTime(10);
      dispatchKey('3');
      vi.advanceTimersByTime(10);
      dispatchKey('4');
      vi.advanceTimersByTime(10);
      dispatchKey('Enter');
    });

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('1234');
  });

  it('Enterがなくてもアイドルタイムアウトで確定する', () => {
    const onScan = vi.fn();

    renderHook(() =>
      useKeyboardWedgeScan({ active: true, onScan, minChars: 4, maxInterKeyDelayMs: 50, idleFlushMs: 120 })
    );

    act(() => {
      dispatchKey('A');
      vi.advanceTimersByTime(10);
      dispatchKey('B');
      vi.advanceTimersByTime(10);
      dispatchKey('C');
      vi.advanceTimersByTime(10);
      dispatchKey('D');
      vi.advanceTimersByTime(121);
    });

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('ABCD');
  });

  it('人手タイピング相当の遅い入力は無視する', () => {
    const onScan = vi.fn();

    renderHook(() =>
      useKeyboardWedgeScan({ active: true, onScan, minChars: 4, maxInterKeyDelayMs: 50, idleFlushMs: 120 })
    );

    act(() => {
      dispatchKey('1');
      vi.advanceTimersByTime(80);
      dispatchKey('2');
      vi.advanceTimersByTime(80);
      dispatchKey('3');
      vi.advanceTimersByTime(80);
      dispatchKey('4');
      vi.advanceTimersByTime(10);
      dispatchKey('Enter');
    });

    expect(onScan).not.toHaveBeenCalled();
  });

  it('フォーム入力中のキーイベントは取り込まない', () => {
    const onScan = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);

    renderHook(() =>
      useKeyboardWedgeScan({ active: true, onScan, minChars: 4, maxInterKeyDelayMs: 50, idleFlushMs: 120 })
    );

    act(() => {
      dispatchKey('1', input);
      vi.advanceTimersByTime(10);
      dispatchKey('2', input);
      vi.advanceTimersByTime(10);
      dispatchKey('3', input);
      vi.advanceTimersByTime(10);
      dispatchKey('4', input);
      vi.advanceTimersByTime(10);
      dispatchKey('Enter', input);
      vi.advanceTimersByTime(150);
    });

    expect(onScan).not.toHaveBeenCalled();
    input.remove();
  });
});
