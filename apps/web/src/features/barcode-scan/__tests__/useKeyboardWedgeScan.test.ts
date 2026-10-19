import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claimKeyboardWedgeScanOwner,
  releaseKeyboardWedgeScanOwner,
  useKeyboardWedgeScan
} from '../useKeyboardWedgeScan';

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
    releaseKeyboardWedgeScanOwner('first');
    releaseKeyboardWedgeScanOwner('second');
  });

  it('高速入力とEnterでスキャン確定する', () => {
    const onScan = vi.fn();

    const { unmount } = renderHook(() =>
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
    unmount();
  });

  it('Enterがなくてもアイドルタイムアウトで確定する', () => {
    const onScan = vi.fn();

    const { unmount } = renderHook(() =>
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
    unmount();
  });

  it('人手タイピング相当の遅い入力は無視する', () => {
    const onScan = vi.fn();

    const { unmount } = renderHook(() =>
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
    unmount();
  });

  it('フォーム入力中のキーイベントは取り込まない', () => {
    const onScan = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);

    const { unmount } = renderHook(() =>
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
    unmount();
    input.remove();
  });

  it('所有者を切り替えると途中入力とアイドル確定を破棄し、現在の所有者だけが受信する', () => {
    const firstScan = vi.fn();
    const secondScan = vi.fn();
    const first = renderHook(() => useKeyboardWedgeScan({
      active: true,
      owner: 'first',
      onScan: firstScan,
      minChars: 4,
      idleFlushMs: 120
    }));
    const second = renderHook(() => useKeyboardWedgeScan({
      active: true,
      owner: 'second',
      onScan: secondScan,
      minChars: 4,
      idleFlushMs: 120
    }));

    act(() => claimKeyboardWedgeScanOwner('first'));
    act(() => {
      dispatchKey('O');
      dispatchKey('L');
      dispatchKey('D');
      dispatchKey('1');
    });
    act(() => claimKeyboardWedgeScanOwner('second'));
    act(() => {
      vi.advanceTimersByTime(200);
      dispatchKey('1');
      vi.advanceTimersByTime(10);
      dispatchKey('2');
      vi.advanceTimersByTime(10);
      dispatchKey('3');
      vi.advanceTimersByTime(10);
      dispatchKey('4');
      dispatchKey('Enter');
    });

    expect(firstScan).not.toHaveBeenCalled();
    expect(secondScan).toHaveBeenCalledWith('1234');
    act(() => releaseKeyboardWedgeScanOwner('second'));
    first.unmount();
    second.unmount();
  });

  it('所有者を解放すると既定の受信hookへ戻り、同じ処理内の切替で古い入力を確定しない', () => {
    const onScan = vi.fn();
    const { unmount } = renderHook(() => useKeyboardWedgeScan({
      active: true,
      onScan,
      minChars: 4,
      idleFlushMs: 120
    }));

    act(() => {
      dispatchKey('O');
      dispatchKey('L');
      dispatchKey('D');
      dispatchKey('1');
      claimKeyboardWedgeScanOwner('first');
      releaseKeyboardWedgeScanOwner('first');
      vi.advanceTimersByTime(200);
    });
    expect(onScan).not.toHaveBeenCalled();
    act(() => {
      dispatchKey('A');
      vi.advanceTimersByTime(10);
      dispatchKey('B');
      vi.advanceTimersByTime(10);
      dispatchKey('C');
      vi.advanceTimersByTime(10);
      dispatchKey('D');
      dispatchKey('Enter');
    });

    expect(onScan).toHaveBeenCalledWith('ABCD');
    unmount();
  });

  it('排他的な所有者がいる間は既定hookへ配送せず、解放後に既定hookへ戻る', () => {
    const defaultScan = vi.fn();
    const ownedScan = vi.fn();
    const defaultHook = renderHook(() => useKeyboardWedgeScan({ active: true, onScan: defaultScan, minChars: 4 }));
    const ownedHook = renderHook(() => useKeyboardWedgeScan({
      active: true,
      owner: 'first',
      onScan: ownedScan,
      minChars: 4
    }));

    act(() => claimKeyboardWedgeScanOwner('first'));
    act(() => {
      dispatchKey('O');
      dispatchKey('W');
      dispatchKey('N');
      dispatchKey('R');
      dispatchKey('Enter');
    });
    expect(ownedScan).toHaveBeenCalledWith('OWNR');
    expect(defaultScan).not.toHaveBeenCalled();

    act(() => releaseKeyboardWedgeScanOwner('first'));
    act(() => {
      dispatchKey('B');
      dispatchKey('A');
      dispatchKey('C');
      dispatchKey('K');
      dispatchKey('Enter');
    });
    expect(defaultScan).toHaveBeenCalledWith('BACK');
    defaultHook.unmount();
    ownedHook.unmount();
  });
});
