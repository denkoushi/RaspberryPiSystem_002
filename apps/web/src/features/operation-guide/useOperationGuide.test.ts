import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useOperationGuide } from './useOperationGuide';

describe('useOperationGuide', () => {
  it('preserves the result and callbacks across unrelated rerenders and progress changes', () => {
    const hook = renderHook(() => useOperationGuide());
    const initial = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(initial);
    act(() => { initial.receive('手順書の作り方'); });
    expect(hook.result.current.receive).toBe(initial.receive);
    expect(hook.result.current.choose).toBe(initial.choose);
    expect(hook.result.current.clear).toBe(initial.clear);
    act(() => { initial.choose('assembly-edit'); });
    const chosen = hook.result.current;
    act(() => { chosen.next(); });
    expect(hook.result.current.index).toBe(1);
    for (const key of ['receive', 'choose', 'next', 'back', 'clear'] as const) {
      expect(hook.result.current[key]).toBe(chosen[key]);
    }
    const progressed = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(progressed);
  });

  it('uses the current guide length, bounds navigation and clears local state', () => {
    const hook = renderHook(() => useOperationGuide());
    act(() => { hook.result.current.choose('assembly-edit'); });
    act(() => { for (let index = 0; index < 10; index++) hook.result.current.next(); });
    expect(hook.result.current.index).toBe(9);
    act(() => { hook.result.current.choose('assembly-register'); });
    expect(hook.result.current.index).toBe(0);
    act(() => { for (let index = 0; index < 10; index++) hook.result.current.next(); });
    expect(hook.result.current.index).toBe(5);
    act(() => { for (let index = 0; index < 10; index++) hook.result.current.back(); });
    expect(hook.result.current.index).toBe(0);
    act(() => { hook.result.current.clear(); });
    expect(hook.result.current).toMatchObject({ question: null, guide: null, index: 0 });
    act(() => { hook.result.current.next(); });
    expect(hook.result.current.index).toBe(0);
    expect(hook.result.current.receive('品番ABCの不適合は?')).toBe(false);
    expect(hook.result.current.question).toBeNull();
  });
});
