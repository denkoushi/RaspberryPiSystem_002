import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useLeaderBoardGanttBodyHeight } from '../useLeaderBoardGanttBodyHeight';

describe('useLeaderBoardGanttBodyHeight', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('falls back to clientHeight when ResizeObserver is undefined', () => {
    // @ts-expect-error test override
    globalThis.ResizeObserver = undefined;

    const element = document.createElement('div');
    Object.defineProperty(element, 'clientHeight', { value: 360, configurable: true });
    document.body.appendChild(element);

    const ref = createRef<HTMLDivElement>();
    ref.current = element;

    const { result } = renderHook(() => useLeaderBoardGanttBodyHeight(ref, true));
    expect(result.current).toBe(360);
  });
});
