import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as buildConfig from '../../config/productionBuildConfig';

import {
  extractKioskEntryScript,
  kioskIdleWebNavigation,
  startBrowserKioskWebUpdate
} from './browserKioskSeamlessUpdate';
import { KIOSK_WEB_UPDATE_IDLE_MS, KIOSK_WEB_UPDATE_POLL_MS, KIOSK_WEB_UPDATE_STORAGE_KEY } from './kioskSeamlessUpdate';

const html = (entry = '/assets/app-new.js') => `<html><head><script type="module" src="${entry}"></script></head><body><div id="root"></div></body></html>`;
const config = buildConfig.readProductionBuildConfig();

describe('entry script extraction', () => {
  it('reads a same-origin production module script', () => {
    expect(extractKioskEntryScript(html(), 'text/html; charset=utf-8', 'http://localhost:3000'))
      .toBe('http://localhost:3000/assets/app-new.js');
  });
  it.each([
    ['<html><div id="root"></div></html>', 'text/html'],
    [html(), 'application/json'],
    [html(), null],
    ['not html', 'text/html'],
    ['<html><p>maintenance</p></html>', 'text/html'],
    [html('/src/main.tsx'), 'text/html'],
    [html('https://other.example/assets/app.js'), 'text/html'],
    [html().replace('type="module"', 'type="text/javascript"'), 'text/html'],
    [html().replace('</head>', '<script type="module" src="/assets/second.js"></script></head>'), 'text/html'],
    [html().replace('<div id="root"></div>', '<div>maintenance</div>'), 'text/html']
  ])('rejects unknown or ambiguous documents: %s', (body, type) => {
    expect(extractKioskEntryScript(body!, type, 'http://localhost:3000')).toBeNull();
  });
});

describe('browser idle Web update', () => {
  let stop: (() => void) | undefined;
  const fetchMock = vi.fn<typeof fetch>();
  let replace: ReturnType<typeof vi.spyOn>;
  let maintenance = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(buildConfig, 'readProductionBuildConfig').mockReturnValue({ ...config, isDevelopment: false });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    replace = vi.spyOn(kioskIdleWebNavigation, 'replace').mockImplementation(() => {});
    window.history.replaceState(null, '', '/kiosk/tag?mode=active#panel');
    document.head.innerHTML = '<script type="module" src="/assets/app-old.js"></script>';
    document.body.innerHTML = '<div id="root"></div>';
    sessionStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(html(), { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    maintenance = false;
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  // Start with the last input old enough that the first poll already meets the idle threshold.
  const start = () => {
    const now = Date.now();
    vi.setSystemTime(now - (KIOSK_WEB_UPDATE_IDLE_MS - KIOSK_WEB_UPDATE_POLL_MS));
    stop = startBrowserKioskWebUpdate(() => maintenance);
    vi.setSystemTime(now);
  };
  const poll = () => vi.advanceTimersByTimeAsync(KIOSK_WEB_UPDATE_POLL_MS);

  it('polls the current pathname with no-store and persists before replacing the exact URL', async () => {
    replace.mockImplementation(() => { expect(sessionStorage.getItem(KIOSK_WEB_UPDATE_STORAGE_KEY)).not.toBeNull(); });
    start();
    await vi.advanceTimersByTimeAsync(KIOSK_WEB_UPDATE_POLL_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledWith('/kiosk/tag', { cache: 'no-store', signal: expect.any(AbortSignal) });
    expect(replace).toHaveBeenCalledWith(window.location.href);
    expect(window.location.search).toBe('?mode=active');
    expect(window.location.hash).toBe('#panel');
    await poll();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup', 'touchstart', 'touchmove', 'touchend', 'wheel'])
    ('defers switching after %s input', async (event) => {
      start();
      await vi.advanceTimersByTimeAsync(1_000);
      window.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(KIOSK_WEB_UPDATE_POLL_MS - 1_000);
      expect(replace).not.toHaveBeenCalled();
      await poll();
      expect(replace).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(KIOSK_WEB_UPDATE_IDLE_MS);
      expect(replace).toHaveBeenCalledTimes(1);
    });

  it.each([
    '<input />', '<textarea></textarea>', '<select><option>one</option></select>',
    '<div role="dialog"></div>', '<dialog open></dialog>',
    '<section class="hermes-chat-panel"></section>', '<section class="operation-guide-card"></section>'
  ])('blocks an active input or overlay: %s', async (element) => {
    document.body.insertAdjacentHTML('beforeend', element);
    document.querySelector<HTMLElement>('input, textarea, select')?.focus();
    start();
    await poll();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not switch offline or during maintenance, then switches when safe', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    start();
    await poll();
    expect(fetchMock).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    maintenance = true;
    await poll();
    expect(fetchMock).not.toHaveBeenCalled();
    maintenance = false;
    await poll();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it.each(['input', 'maintenance', 'path', 'offline', 'stop'])('rechecks %s while HTML is in flight', async (change) => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    start();
    await poll();
    if (change === 'input') window.dispatchEvent(new Event('keydown'));
    if (change === 'maintenance') maintenance = true;
    if (change === 'path') window.history.replaceState(null, '', '/admin');
    if (change === 'offline') vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    if (change === 'stop') stop?.();
    resolve(new Response(html(), { headers: { 'content-type': 'text/html' } }));
    await vi.advanceTimersByTimeAsync(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['failed-fetch', 'non-html', 'http-error', 'same-entry', 'redirect', 'corrupt-storage', 'unavailable-storage'])
    ('ignores %s', async (failure) => {
      if (failure === 'failed-fetch') fetchMock.mockRejectedValue(new Error('offline'));
      if (failure === 'non-html') fetchMock.mockImplementation(async () => new Response(html(), { headers: { 'content-type': 'application/json' } }));
      if (failure === 'http-error') fetchMock.mockImplementation(async () => new Response(html(), { status: 503, headers: { 'content-type': 'text/html' } }));
      if (failure === 'same-entry') fetchMock.mockImplementation(async () => new Response(html('/assets/app-old.js'), { headers: { 'content-type': 'text/html' } }));
      if (failure === 'redirect') fetchMock.mockImplementation(async () => {
        const response = new Response(html(), { headers: { 'content-type': 'text/html' } });
        Object.defineProperty(response, 'redirected', { value: true });
        return response;
      });
      if (failure === 'corrupt-storage') sessionStorage.setItem(KIOSK_WEB_UPDATE_STORAGE_KEY, '{broken');
      if (failure === 'unavailable-storage') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
      start();
      await poll();
      expect(replace).not.toHaveBeenCalled();
    });

  it.each(['development', 'not-kiosk', 'unknown-entry'])('does not start in %s', async (condition) => {
    if (condition === 'development') vi.spyOn(buildConfig, 'readProductionBuildConfig').mockReturnValue({ ...config, isDevelopment: true });
    if (condition === 'not-kiosk') window.history.replaceState(null, '', '/admin');
    if (condition === 'unknown-entry') document.head.innerHTML = '';
    start();
    await poll();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a pending request and removes timers on cleanup', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    start();
    await poll();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    stop?.();
    expect(signal?.aborted).toBe(true);
    await poll();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
