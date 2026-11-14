import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePlanningBoardGanttWindow } from './usePlanningBoardGanttWindow';

function viewport(width = 400, left = 600) {
  const element = document.createElement('div');
  const clientWidth = vi.fn(() => width);
  const scrollLeft = vi.fn(() => left);
  Object.defineProperties(element, { clientWidth: { get: clientWidth }, scrollLeft: { get: scrollLeft } });
  return { element, clientWidth, scrollLeft };
}
const initialProps = { labelWidth: 100, scale: 1, dayWidth: 300, width: 1200 };
function mount(ref: { current: HTMLDivElement | null }) {
  return renderHook(({ labelWidth, scale, dayWidth, width }) =>
    usePlanningBoardGanttWindow(ref, labelWidth, `${scale}:${dayWidth}:${width}`), { initialProps });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('usePlanningBoardGanttWindow', () => {
  it('measures on mount even without ResizeObserver and keeps the initial render empty', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const pane = viewport();
    const rendered: unknown[] = [];
    const ref = { current: pane.element };
    const hook = renderHook(() => {
      const value = usePlanningBoardGanttWindow(ref, 100, 'initial');
      rendered.push(value.window);
      return value;
    });
    expect(rendered[0]).toEqual({ left: Infinity, right: -Infinity });
    expect(hook.result.current.window).toEqual({ left: 300, right: 1500 });
    expect(pane.clientWidth).toHaveBeenCalledTimes(1);
    expect(pane.scrollLeft).toHaveBeenCalledTimes(1);
  });

  it('does not read geometry on unrelated parent renders', () => {
    const pane = viewport();
    const hook = mount({ current: pane.element });
    pane.clientWidth.mockClear(); pane.scrollLeft.mockClear();
    hook.rerender({ ...initialProps });
    expect(pane.clientWidth).not.toHaveBeenCalled();
    expect(pane.scrollLeft).not.toHaveBeenCalled();
  });

  it.each(['scale', 'dayWidth', 'width', 'labelWidth'] as const)('remeasures before paint when %s changes and scrollLeft is clamped', key => {
    const pane = viewport();
    const hook = mount({ current: pane.element });
    pane.clientWidth.mockClear(); pane.scrollLeft.mockClear();
    pane.scrollLeft.mockReturnValue(0);
    hook.rerender({ ...initialProps, [key]: initialProps[key] + 1 });
    expect(pane.clientWidth).toHaveBeenCalledTimes(1);
    expect(pane.scrollLeft).toHaveBeenCalledTimes(1);
    expect(hook.result.current.window).toEqual({ left: 0, right: key === 'labelWidth' ? 897 : 900 });
  });

  it('observes resizing and follows viewport replacement with observer cleanup', () => {
    const observers: { callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(readonly callback: () => void) { observers.push(this); }
    });
    const pane = viewport();
    const ref = { current: pane.element };
    const hook = mount(ref);
    expect(observers[0]!.observe).toHaveBeenCalledWith(pane.element);
    pane.clientWidth.mockReturnValue(500);
    act(() => observers[0]!.callback());
    expect(hook.result.current.window).toEqual({ left: 0, right: 1600 });
    const replacement = viewport(600, 1000);
    ref.current = replacement.element;
    hook.rerender({ ...initialProps });
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(observers[1]!.observe).toHaveBeenCalledWith(replacement.element);
    expect(hook.result.current.window).toEqual({ left: 500, right: 2500 });
    hook.unmount();
    expect(observers[1]!.disconnect).toHaveBeenCalledTimes(1);
  });

  it('remeasures explicit programmatic writes and scroll events', () => {
    let nextFrame!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { nextFrame = callback; return 1; }));
    const pane = viewport();
    const hook = mount({ current: pane.element });
    pane.scrollLeft.mockReturnValue(0);
    act(() => hook.result.current.measure());
    expect(hook.result.current.window).toEqual({ left: 0, right: 900 });
    pane.scrollLeft.mockReturnValue(1200);
    act(() => { hook.result.current.onScroll(); nextFrame(0); });
    expect(hook.result.current.window).toEqual({ left: 900, right: 2100 });
  });
});
