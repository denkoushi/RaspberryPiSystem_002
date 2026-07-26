import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_UNSAVED_NAVIGATION_MESSAGE,
  useUnsavedChangesGuard
} from './useUnsavedChangesGuard';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('useUnsavedChangesGuard', () => {
  it('blocks browser unload while changes are dirty', () => {
    renderHook(() => useUnsavedChangesGuard(true));

    const event = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('blocks an internal same-window link when the user cancels', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderHook(() => useUnsavedChangesGuard(true));
    const anchor = document.createElement('a');
    anchor.href = `${window.location.origin}/kiosk/assembly/library`;
    const child = document.createElement('span');
    anchor.append(child);
    document.body.append(anchor);

    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0
    });
    child.dispatchEvent(event);

    expect(confirm).toHaveBeenCalledWith(DEFAULT_UNSAVED_NAVIGATION_MESSAGE);
    expect(event.defaultPrevented).toBe(true);
  });

  it('allows imperative navigation after confirmation and bypasses the guard when clean', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result, rerender } = renderHook(
      ({ dirty }) => useUnsavedChangesGuard(dirty, '統合エディターから移動しますか？'),
      { initialProps: { dirty: true } }
    );

    expect(result.current.confirmNavigation()).toBe(true);
    expect(confirm).toHaveBeenCalledWith('統合エディターから移動しますか？');

    act(() => rerender({ dirty: false }));
    confirm.mockClear();
    expect(result.current.confirmNavigation()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
