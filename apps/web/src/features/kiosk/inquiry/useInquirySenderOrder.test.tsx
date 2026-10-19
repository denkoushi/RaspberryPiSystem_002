import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInquirySenderOrder } from './useInquirySenderOrder';

const ids = ['a', 'b', 'c'];
const storageKey = (department = '機械課') => `kiosk.inquiry.sender-order:${department}`;
function Harness({ department = '機械課', members = ids, disabled = false }: { department?: string; members?: string[]; disabled?: boolean }) {
  const order = useInquirySenderOrder(members, department, disabled);
  const [selected, setSelected] = useState('');
  return <div>{order.order.map(id => <button key={id} data-sender-id={id} type="button" aria-pressed={selected === id}
    onPointerDown={event => order.onPointerDown(event, id)} onPointerMove={order.onPointerMove}
    onPointerUp={order.onPointerUp} onPointerCancel={order.onPointerCancel} onLostPointerCapture={order.onPointerCancel}
    onKeyDown={event => order.onKeyDown(event, id)} onClick={event => { if (order.onClick(event)) setSelected(id); }}>{id}</button>)}</div>;
}
const names = () => screen.getAllByRole('button').map(button => button.textContent);
const button = (name: string) => screen.getByRole('button', { name });
const move = (name: string, key: string) => fireEvent.keyDown(button(name), { altKey: true, key });
const pointer = (target: HTMLElement, type: string, x: number, y = 20) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y });
  act(() => { target.dispatchEvent(event); });
};
function mockSlots() {
  screen.getAllByRole('button').forEach((element, index) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: index * 110, top: 0, right: index * 110 + 104, bottom: 40, width: 104, height: 40, x: index * 110, y: 0, toJSON: () => ({})
    });
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useInquirySenderOrder', () => {
  it('reads saved order, ignores missing/duplicate ids and appends new employees in original order', () => {
    localStorage.setItem(storageKey(), JSON.stringify(['missing', 'c', 'c']));
    render(<Harness />);
    expect(names()).toEqual(['c', 'a', 'b']);
  });

  it('moves with Alt+arrows, retains focus and persists independently for each department', () => {
    localStorage.setItem(storageKey('製造課'), JSON.stringify(['c', 'b', 'a']));
    const view = render(<Harness />);
    button('a').focus();
    move('a', 'ArrowRight');
    expect(names()).toEqual(['b', 'a', 'c']);
    expect(button('a')).toHaveFocus();
    expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual(['b', 'a', 'c']);
    view.rerender(<Harness department="製造課" />);
    expect(names()).toEqual(['c', 'b', 'a']);
    move('a', 'ArrowLeft');
    expect(JSON.parse(localStorage.getItem(storageKey('製造課'))!)).toEqual(['c', 'a', 'b']);
    view.rerender(<Harness />);
    expect(names()).toEqual(['b', 'a', 'c']);
    view.unmount();
    render(<Harness />);
    expect(names()).toEqual(['b', 'a', 'c']);
  });

  it.each(['not-json', '{}', 'null', '["c",1]'])('uses default order for corrupt storage (%s)', value => {
    localStorage.setItem(storageKey(), value);
    render(<Harness />);
    expect(names()).toEqual(ids);
  });

  it('uses default order on read failure and can reorder on write failure', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    render(<Harness />);
    expect(names()).toEqual(ids);
    move('a', 'ArrowRight');
    expect(names()).toEqual(['b', 'a', 'c']);
  });

  it('holds to drag, shifts neighbours before release, batches moves and does not select on release', () => {
    vi.useFakeTimers();
    render(<Harness />);
    mockSlots();
    const a = button('a');
    const capture = vi.fn();
    const release = vi.fn();
    Object.assign(a, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release });
    pointer(a, 'pointerdown', 52);
    expect(capture).toHaveBeenCalledWith(1);
    act(() => vi.advanceTimersByTime(249));
    expect(a).not.toHaveAttribute('data-dragging');
    act(() => vi.advanceTimersByTime(1));
    expect(a).toHaveAttribute('data-dragging');
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    pointer(a, 'pointermove', 120);
    pointer(a, 'pointermove', 272);
    expect(raf).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(20));
    expect(a.style.transform).toBe('translate3d(220px, 0px, 0)');
    expect(button('b').style.transform).toBe('translate3d(-110px, 0px, 0)');
    expect(button('c').style.transform).toBe('translate3d(-110px, 0px, 0)');
    for (const element of screen.getAllByRole('button')) expect(element.getBoundingClientRect).toHaveBeenCalledOnce();
    expect(localStorage.getItem(storageKey())).toBeNull();
    pointer(a, 'pointerup', 272);
    fireEvent.click(a);
    expect(names()).toEqual(['b', 'c', 'a']);
    expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual(['b', 'c', 'a']);
    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(a.style.transform).toBe('');
    expect(a).not.toHaveAttribute('data-dragging');
    expect(release).toHaveBeenCalledWith(1);
    pointer(a, 'pointerdown', 272);
    pointer(a, 'pointerup', 272);
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'true');
  });

  it('cancels before the hold threshold to allow scrolling, while short taps still select', () => {
    vi.useFakeTimers();
    render(<Harness />);
    const a = button('a');
    pointer(a, 'pointerdown', 52);
    pointer(a, 'pointermove', 52, 30);
    act(() => vi.advanceTimersByTime(300));
    expect(a).not.toHaveAttribute('data-dragging');
    pointer(a, 'pointerup', 52, 30);
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(storageKey())).toBeNull();
    pointer(a, 'pointerdown', 52);
    act(() => vi.advanceTimersByTime(100));
    pointer(a, 'pointerup', 52);
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-pressed', 'true');
  });

  it('blocks native touch scrolling only after the hold completes', () => {
    vi.useFakeTimers();
    render(<Harness />);
    mockSlots();
    const a = button('a');
    pointer(a, 'pointerdown', 52);
    expect(fireEvent.touchMove(a)).toBe(true);
    act(() => vi.advanceTimersByTime(250));
    expect(fireEvent.touchMove(a)).toBe(false);
    pointer(a, 'pointercancel', 52);
    expect(fireEvent.touchMove(a)).toBe(true);
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur', 'resize', 'scroll'])('abandons transforms and does not save on %s', reason => {
    vi.useFakeTimers();
    render(<Harness />);
    mockSlots();
    const a = button('a');
    pointer(a, 'pointerdown', 52);
    act(() => vi.advanceTimersByTime(250));
    pointer(a, 'pointermove', 272);
    act(() => vi.advanceTimersByTime(20));
    if (reason === 'Escape') fireEvent.keyDown(a, { key: 'Escape' });
    else if (reason.startsWith('pointer') || reason === 'lostpointercapture') pointer(a, reason, 272);
    else fireEvent(window, new Event(reason));
    expect(a.style.transform).toBe('');
    expect(a).not.toHaveAttribute('data-dragging');
    expect(names()).toEqual(ids);
    expect(localStorage.getItem(storageKey())).toBeNull();
  });

  it('cleans up a pending hold on department change and unmount', () => {
    vi.useFakeTimers();
    const view = render(<Harness />);
    const a = button('a');
    pointer(a, 'pointerdown', 52);
    view.rerender(<Harness department="製造課" />);
    act(() => vi.advanceTimersByTime(300));
    expect(a).not.toHaveAttribute('data-dragging');
    pointer(a, 'pointerdown', 52);
    view.unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(a).not.toHaveAttribute('data-dragging');
    expect(localStorage.getItem(storageKey())).toBeNull();
  });
});
