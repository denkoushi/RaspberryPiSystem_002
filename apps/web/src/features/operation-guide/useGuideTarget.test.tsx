import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGuideTarget } from './useGuideTarget';

const rect = (left: number, top: number, width = 100, height = 44) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
function tick() { act(() => { vi.advanceTimersByTime(200); }); }
function target(id = 'example') {
  const element = document.createElement('button');
  element.dataset.kioskSopTarget = id;
  element.getBoundingClientRect = vi.fn(() => rect(100, 100));
  document.body.append(element);
  return element;
}
const cardRef = { current: null };
const iconRef = { current: null };
function track() { return renderHook(({ id, route }) => useGuideTarget(id, route, cardRef, iconRef), { initialProps: { id: 'example', route: 'library' } }); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'requestAnimationFrame');
});
afterEach(() => { document.querySelectorAll('[data-kiosk-sop-target], [role="dialog"]').forEach(element => element.remove()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('live target tracking', () => {
  it('tracks appearance, scroll/layout movement, resize and disappearance', () => {
    const hook = track();
    expect(hook.result.current.target).toBeNull();
    const element = target(); tick();
    expect(hook.result.current.target?.left).toBe(100);
    element.getBoundingClientRect = vi.fn(() => rect(120, 90, 150, 50)); tick();
    expect(hook.result.current.target).toEqual({ left: 120, top: 90, width: 150, height: 50 });
    element.remove(); tick();
    expect(hook.result.current.target).toBeNull();
  });
  it('hides hidden/offscreen elements and uses the first visible duplicate', () => {
    const hidden = target(); hidden.hidden = true;
    const visible = target();
    const hook = track();
    expect(hook.result.current.target).not.toBeNull();
    visible.getBoundingClientRect = vi.fn(() => rect(-200, 100)); tick();
    expect(hook.result.current.target).toBeNull();
    hidden.hidden = false; tick();
    expect(hook.result.current.target).not.toBeNull();
  });
  it('tracks dialogs and does not highlight an obscured background control', () => {
    const background = target();
    const hook = track();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.getBoundingClientRect = () => rect(10, 10, 500, 500);
    document.body.append(dialog); tick();
    expect(hook.result.current.target).toBeNull();
    const inside = target(); dialog.append(inside); tick();
    expect(hook.result.current.target).not.toBeNull();
    dialog.remove(); tick();
    expect(hook.result.current.target).not.toBeNull();
    background.remove(); tick();
    expect(hook.result.current.target).toBeNull();
  });
  it('measures nested scroll and resize immediately without waiting for the interval', () => {
    const element = target();
    const hook = track();
    element.getBoundingClientRect = vi.fn(() => rect(120, 90));
    act(() => { element.dispatchEvent(new Event('scroll', { bubbles: false })); });
    expect(hook.result.current.target?.left).toBe(120);
    element.getBoundingClientRect = vi.fn(() => rect(140, 80));
    vi.stubGlobal('innerWidth', 900);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(hook.result.current.target?.left).toBe(140);
    expect(hook.result.current.viewport.width).toBe(900);
  });
  it('samples at most five times per second when idle and preserves unchanged geometry', () => {
    const element = target();
    const hook = track();
    const initial = hook.result.current;
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(199); });
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(801); });
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(6);
    expect(hook.result.current).toBe(initial);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  });
  it('switches the tracked target on step and route changes, then cleans up', () => {
    target(); const next = target('next'); next.getBoundingClientRect = () => rect(220, 100);
    const hook = track();
    hook.rerender({ id: 'next', route: 'editor' });
    expect(hook.result.current.target?.left).toBe(220);
    expect(vi.getTimerCount()).toBe(1);
    const measure = vi.spyOn(next, 'getBoundingClientRect');
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      next.dispatchEvent(new Event('scroll', { bubbles: false }));
      vi.advanceTimersByTime(1000);
    });
    expect(measure).not.toHaveBeenCalled();
  });
});
