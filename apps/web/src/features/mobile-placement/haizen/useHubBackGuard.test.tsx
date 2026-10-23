import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { haizenTabNavigationOptions, useHubBackGuard } from './useHubBackGuard';

const hub = '/kiosk/mobile-placement';
type Entry = { state: unknown; url: string };
let entries: Entry[];
let cursor: number;

// Deterministic browser history: real jsdom URLs and popstate dispatch, with a
// resettable stack (jsdom's native history cannot be cleared between tests).
beforeEach(() => {
  const replace = window.history.replaceState.bind(window.history);
  entries = [{ state: { idx: 0, key: 'previous' }, url: '/previous' },
    { state: { idx: 1, key: 'hub', usr: { restored: 'value' } }, url: `${hub}?clientKey=test#top` }];
  cursor = 1;
  replace(entries[cursor].state, '', entries[cursor].url);
  vi.spyOn(window.history, 'pushState').mockImplementation((state, _unused, url) => {
    entries.splice(cursor + 1, entries.length, { state, url: String(url) });
    cursor += 1;
    replace(state, '', url);
  });
  vi.spyOn(window.history, 'replaceState').mockImplementation((state, _unused, url) => {
    entries[cursor] = { state, url: String(url ?? entries[cursor].url) };
    replace(state, '', url);
  });
  vi.spyOn(window.history, 'go').mockImplementation((delta = 0) => {
    const next = cursor + delta;
    if (next < 0 || next >= entries.length || delta === 0) return;
    cursor = next;
    replace(entries[cursor].state, '', entries[cursor].url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: entries[cursor].state }));
  });
  vi.spyOn(window.history, 'back').mockImplementation(() => window.history.go(-1));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Hub({ enabled }: { enabled: boolean }) {
  const [overlay, setOverlay] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useHubBackGuard(enabled, overlay ? () => setOverlay(null) : null);
  return <>
    <input aria-label="slip" value={value} onChange={(event) => setValue(event.target.value)} />
    <output>{location.pathname}</output>
    <button onClick={() => setOverlay('scanner')}>scan</button>
    <button onClick={() => setOverlay('sheet')}>sheet</button>
    {overlay && <div role="dialog">{overlay}</div>}
    <button onClick={() => navigate(hub, { replace: true, state: { restored: 'updated' } })}>replace</button>
    <Link to="/kiosk/purchase-order-lookup">sub-screen</Link>
    <button onClick={() => navigate('/kiosk/purchase-order-lookup', haizenTabNavigationOptions())}>purchase tab</button>
  </>;
}

function SubScreen() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(-1)}>return to hub</button>
    <button onClick={() => navigate(hub, haizenTabNavigationOptions({ openHaizenMenu: true }))}>hub tab</button>
  </>;
}

function mount(enabled = true) {
  return render(<StrictMode><BrowserRouter><Routes>
    <Route path={hub} element={<Hub enabled={enabled} />} />
    <Route path="/kiosk/purchase-order-lookup" element={<SubScreen />} />
    <Route path="*" element={<div>previous page</div>} />
  </Routes></BrowserRouter></StrictMode>);
}

describe('useHubBackGuard with BrowserRouter', () => {
  it('keeps the hub, URL, router state and in-progress input on repeated Back', () => {
    mount();
    expect(entries).toHaveLength(3); // StrictMode must not add a second sentinel.
    const state = window.history.state;
    expect(state).toMatchObject({ idx: 1, key: 'hub', usr: { restored: 'value' } });
    fireEvent.change(screen.getByLabelText('slip'), { target: { value: '移動票 / 現品票 / 棚' } });
    for (let i = 0; i < 5; i += 1) act(() => window.history.back());
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(`${hub}?clientKey=test#top`);
    expect(window.history.state).toEqual(state);
    expect(screen.getByLabelText('slip')).toHaveValue('移動票 / 現品票 / 棚');
    expect(entries).toHaveLength(3);
  });

  it.each(['scan', 'sheet'])('closes the current %s overlay before guarding the hub', (button) => {
    mount();
    fireEvent.click(screen.getByText(button));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => window.history.back());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('slip')).toBeInTheDocument();
    act(() => window.history.back());
    expect(entries).toHaveLength(3);
  });

  it('reuses the sentinel across sub-screen visits and browser/router Back', () => {
    mount();
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByText('sub-screen'));
      expect(window.location.pathname).toBe('/kiosk/purchase-order-lookup');
      expect(window.history.state.idx).toBe(2);
      expect(entries).toHaveLength(4);
      if (i % 2 === 0) act(() => window.history.back());
      else fireEvent.click(screen.getByText('return to hub'));
      expect(screen.getByLabelText('slip')).toBeInTheDocument();
      expect(window.history.state.idx).toBe(1);
      expect(cursor).toBe(2);
      expect(entries).toHaveLength(4);
    }
    act(() => window.history.back());
    expect(entries).toHaveLength(3);
    fireEvent.click(screen.getByText('sub-screen'));
    act(() => window.history.go(-2)); // Only the sub-screen is mounted: do not intercept.
    expect(screen.getByLabelText('slip')).toBeInTheDocument();
    act(() => window.history.back());
    expect(window.location.pathname).toBe(hub);
  });

  it('reuses the guard on repeated tab replacements and closes overlays on Back', () => {
    mount();
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByText('purchase tab'));
      expect(entries).toHaveLength(3);
      expect(window.history.state.idx).toBe(1);
      fireEvent.click(screen.getByText('hub tab'));
      expect(entries).toHaveLength(3);
      expect(window.history.state.usr.openHaizenMenu).toBe(true);
      fireEvent.click(screen.getByText('replace')); // Consuming route state also preserves the guard.
      fireEvent.click(screen.getByText('sheet'));
      act(() => window.history.back());
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(entries).toHaveLength(3);
    }
    fireEvent.click(screen.getByText('purchase tab'));
    act(() => window.history.back());
    expect(screen.getByLabelText('slip')).toBeInTheDocument();
    expect(cursor).toBe(2);
    expect(entries).toHaveLength(3);
  });

  it('keeps one sentinel when the router replaces shelf return state', () => {
    mount();
    fireEvent.click(screen.getByText('replace'));
    const state = window.history.state;
    expect(state.usr).toEqual({ restored: 'updated' });
    expect(entries).toHaveLength(3);
    act(() => window.history.back());
    expect(window.history.state).toEqual(state);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(hub);
    expect(entries).toHaveLength(3);
  });

  it('reuses a sentinel after unmount/remount (including a reload)', () => {
    const first = mount();
    first.unmount();
    mount();
    expect(entries).toHaveLength(3);
    act(() => window.history.back());
    expect(screen.getByLabelText('slip')).toBeInTheDocument();
  });

  it('leaves desktop history and Back unchanged when disabled', () => {
    mount(false);
    expect(entries).toHaveLength(2);
    act(() => window.history.back());
    expect(screen.getByText('previous page')).toBeInTheDocument();
  });

  it('removes its listener on unmount', () => {
    mount().unmount();
    act(() => window.history.back());
    expect(cursor).toBe(1);
    act(() => window.history.back());
    expect(window.location.pathname).toBe('/previous');
  });
});
