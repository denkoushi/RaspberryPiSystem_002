// @vitest-environment node
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import workerSource from '../../../public/sw.js?raw';

const origin = 'https://factory.test';
const shellName = 'mobile-app-shell-v1-shell';
const assetName = 'mobile-app-shell-v1-assets';
const html = (version = 'new') => `<html><head><script src="/assets/${version}.js"></script><link href="/assets/app.css" rel="stylesheet"></head><body>app</body></html>`;
const htmlResponse = (version = 'new') => new Response(html(version), { headers: { 'content-type': 'text/html' } });
const manifest = {
  'index.html': { file: 'assets/new.js', imports: ['vendor'], dynamicImports: ['lazy'], css: ['assets/app.css'], assets: ['assets/font.woff2'] },
  vendor: { file: 'assets/vendor.js' }, lazy: { file: 'assets/lazy.js', imports: ['vendor'] }
};
type WorkerEvent = {
  request?: { url: string; method: string; mode: string; referrer: string };
  clientId?: string;
  resultingClientId?: string;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
};

function setup() {
  const listeners: Record<string, (event: WorkerEvent) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (input: string | { url: string }) => new URL(typeof input === 'string' ? input : input.url, origin).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name: string) => stores.delete(name)),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        match: async (input: string | { url: string }) => store.get(key(input))?.clone(),
        put: async (input: string | { url: string }, response: Response) => { store.set(key(input), response.clone()); },
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (input: string | { url: string }) => store.delete(key(input))
      };
    }
  };
  const fetch = vi.fn(async (input: string | { url: string }) => {
    const url = key(input);
    if (url.endsWith('app-shell-manifest.json')) return Response.json(manifest);
    if (url.includes('/assets/')) return new Response('asset', { headers: { 'content-type': 'text/javascript' } });
    return htmlResponse();
  });
  const self = {
    location: { origin },
    addEventListener: (name: string, listener: (event: WorkerEvent) => void) => { listeners[name] = listener; },
    skipWaiting: vi.fn(),
    clients: {
      get: vi.fn(async (_id: string): Promise<{ url: string } | undefined> => ({ url: `${origin}/kiosk/mobile-placement` })),
      matchAll: vi.fn(async () => [] as { id: string }[]),
      claim: vi.fn()
    }
  };
  runInNewContext(workerSource, { self, caches, fetch, URL, Headers, Response, AbortController, setTimeout, clearTimeout });
  function dispatch(name: string, path = '/kiosk/mobile-placement', options: Partial<NonNullable<WorkerEvent['request']>> = {}, clientId = 'mobile-window') {
    const pending: Promise<unknown>[] = [];
    const event = {
      request: { url: new URL(path, origin).href, method: 'GET', mode: 'navigate', referrer: '', ...options },
      clientId,
      resultingClientId: 'new-window',
      waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
      respondWith: vi.fn<(promise: Promise<Response>) => void>()
    };
    listeners[name](event);
    return { event, done: async () => { for (const promise of pending) await promise; } };
  }
  const navigation = async () => {
    const dispatched = dispatch('fetch');
    const response = await dispatched.event.respondWith.mock.calls[0][0];
    await dispatched.done();
    return response;
  };
  return { caches, fetch, self, dispatch, navigation };
}

afterEach(() => vi.useRealTimers());

describe('shipped mobile Service Worker', () => {
  it.each(['/kiosk/mobile-placement', '/kiosk/mobile-placement/part-search?x=1', '/kiosk/purchase-order-lookup', '/kiosk/purchase-order-lookup/'])('handles target navigation %s', async (path) => {
    const worker = setup();
    const { event, done } = worker.dispatch('fetch', path);
    expect(event.respondWith).toHaveBeenCalledOnce();
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe(html());
    await done();
  });

  it.each(['/kiosk/', '/kiosk/tag', '/admin', '/kiosk/mobile-placement-other', '/kiosk/purchase-order-lookup/other', '/api/test', '/ws/test', '/storage/image', '/assets/a.js', 'https://other.test/kiosk/mobile-placement'])('does not respond to unrelated navigation %s', (path) => {
    const { event } = setup().dispatch('fetch', path);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it.each(['/api/test', '/ws/test', '/storage/image', '/sw.js', 'https://other.test/assets/app.js'])('never intercepts %s from a mobile client', (path) => {
    const { event } = setup().dispatch('fetch', path, { mode: 'cors', referrer: `${origin}/kiosk/mobile-placement` });
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it.each([`${origin}/kiosk/tag`, `${origin}/admin`, 'https://other.test/kiosk/mobile-placement'])('leaves other clients assets untouched (%s)', async (url) => {
    const worker = setup();
    worker.self.clients.get.mockResolvedValue({ url });
    await (await worker.caches.open(assetName)).put('/assets/app.js', new Response('cached'));
    const open = vi.spyOn(worker.caches, 'open');
    const { event } = worker.dispatch('fetch', '/assets/app.js', { mode: 'cors', referrer: `${origin}/kiosk/mobile-placement` });
    expect(event.respondWith).toHaveBeenCalledOnce();
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('asset');
    expect(worker.self.clients.get).toHaveBeenCalledWith('mobile-window');
    expect(worker.fetch).toHaveBeenCalledExactlyOnceWith(event.request);
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['', 'missing-window'])('passes through assets when the client is unavailable (%s)', async (clientId) => {
    const worker = setup();
    worker.self.clients.get.mockResolvedValue(undefined);
    const open = vi.spyOn(worker.caches, 'open');
    const { event } = worker.dispatch('fetch', '/assets/app.js', { mode: 'cors', referrer: `${origin}/kiosk/mobile-placement` }, clientId);
    expect(event.respondWith).toHaveBeenCalledOnce();
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('asset');
    expect(worker.fetch).toHaveBeenCalledExactlyOnceWith(event.request);
    expect(open).not.toHaveBeenCalled();
    if (clientId) expect(worker.self.clients.get).toHaveBeenCalledExactlyOnceWith(clientId);
    else expect(worker.self.clients.get).not.toHaveBeenCalled();
  });

  it.each(['/kiosk/mobile-placement', '/assets/app.js'])('does not intercept non-GET requests (%s)', (path) => {
    const { event } = setup().dispatch('fetch', path, { method: 'POST', mode: path.startsWith('/assets/') ? 'cors' : 'navigate' });
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('preloads the complete dependency graph on install before skipWaiting', async () => {
    const worker = setup();
    await worker.dispatch('install').done();
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    const cache = await worker.caches.open(assetName);
    for (const file of ['new.js', 'vendor.js', 'lazy.js', 'app.css', 'font.woff2']) {
      expect(await cache.match(`/assets/${file}`)).toBeDefined();
    }
    expect(await (await (await worker.caches.open(shellName)).match('/index.html'))?.text()).toBe(html());
  });

  it.each([
    ['/kiosk/purchase-order-lookup', '/assets/lazy.js', '/kiosk/purchase-order-lookup'],
    ['/kiosk/mobile-placement', '/assets/lazy.js', '/assets/x.js'],
    ['/kiosk/mobile-placement/part-search?x=1', '/assets/font.woff2', '/assets/app.css']
  ])('serves cached assets for target client %s requesting %s with referrer %s', async (clientPath, assetPath, referrer) => {
    const worker = setup();
    await worker.dispatch('install').done();
    worker.fetch.mockClear();
    worker.fetch.mockRejectedValue(new Error('offline'));
    worker.self.clients.get.mockResolvedValue({ url: `${origin}${clientPath}` });
    const { event } = worker.dispatch('fetch', assetPath, { mode: 'cors', referrer: `${origin}${referrer}` });
    expect(event.respondWith).toHaveBeenCalledOnce();
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('asset');
    expect(worker.self.clients.get).toHaveBeenCalledExactlyOnceWith('mobile-window');
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('returns the latest online HTML, saves it and collects unused assets with no other windows', async () => {
    const worker = setup();
    await (await worker.caches.open(shellName)).put('/index.html', htmlResponse('old'));
    await (await worker.caches.open(assetName)).put('/assets/old.js', new Response('old'));
    expect(await (await worker.navigation()).text()).toBe(html());
    expect(worker.fetch.mock.calls[0][0]).toMatchObject({ url: `${origin}/kiosk/mobile-placement` });
    expect(await (await worker.caches.open(assetName)).match('/assets/old.js')).toBeUndefined();
    worker.fetch.mockRejectedValue(new Error('offline'));
    const fallback = await worker.navigation();
    expect(await fallback.text()).toContain('name="mobile-app-shell-offline"');
  });

  it('does not collect files used by another open window', async () => {
    const worker = setup();
    worker.self.clients.matchAll.mockResolvedValue([{ id: 'old-window' }, { id: 'new-window' }]);
    await (await worker.caches.open(assetName)).put('/assets/old.js', new Response('old'));
    await worker.navigation();
    expect(await (await worker.caches.open(assetName)).match('/assets/old.js')).toBeDefined();
  });

  it('falls back after four seconds even when the network never settles, without cleanup', async () => {
    vi.useFakeTimers();
    const worker = setup();
    await (await worker.caches.open(shellName)).put('/index.html', htmlResponse('old'));
    worker.fetch.mockImplementation(() => new Promise(() => {}));
    const { event } = worker.dispatch('fetch');
    const response = event.respondWith.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(4000);
    expect(await (await response).text()).toContain('/assets/old.js');
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
  });

  it('saves late HTML through waitUntil after serving the old shell without collecting its assets', async () => {
    vi.useFakeTimers();
    const worker = setup();
    const cache = await worker.caches.open(shellName);
    const assets = await worker.caches.open(assetName);
    await cache.put('/index.html', htmlResponse('old'));
    await assets.put('/assets/old.js', new Response('old'));
    let resolveNetwork!: (response: Response) => void;
    worker.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveNetwork = resolve; }));
    const { event, done } = worker.dispatch('fetch');
    let saved = false;
    const saving = done().then(() => { saved = true; });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toContain('/assets/old.js');
    expect(saved).toBe(false);
    expect(await (await cache.match('/index.html'))?.text()).toBe(html('old'));
    expect(worker.fetch).toHaveBeenCalledExactlyOnceWith(event.request, { cache: 'no-store' });

    resolveNetwork(htmlResponse());
    await saving;
    expect(await (await cache.match('/index.html'))?.text()).toBe(html());
    expect(await assets.match('/assets/new.js')).toBeDefined();
    expect(await assets.match('/assets/old.js')).toBeDefined();
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
    worker.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await worker.navigation()).text()).toContain('/assets/new.js');
  });

  it.each([0, 5000])('does not save when navigation fails offline after %i ms', async (delay) => {
    vi.useFakeTimers();
    const worker = setup();
    const cache = await worker.caches.open(shellName);
    await cache.put('/index.html', htmlResponse('old'));
    worker.fetch.mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('offline')), delay);
    }));
    const { event, done } = worker.dispatch('fetch');
    await vi.advanceTimersByTimeAsync(Math.max(4000, delay));
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toContain('/assets/old.js');
    await done();
    expect(worker.fetch).toHaveBeenCalledOnce();
    expect(await (await cache.match('/index.html'))?.text()).toBe(html('old'));
    expect(await (await worker.caches.open(assetName)).keys()).toHaveLength(0);
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
  });

  it.each([false, true])('limits preloads to six and retains successful files (asset failure: %s)', async (failAsset) => {
    const worker = setup();
    const cache = await worker.caches.open(shellName);
    await cache.put('/index.html', htmlResponse('old'));
    const files = ['new.js', 'app.css', ...Array.from({ length: 56 }, (_, i) => `chunk-${i}.js`)];
    let active = 0;
    let peak = 0;
    let fetched = 0;
    worker.fetch.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('app-shell-manifest.json')) {
        return Response.json({ 'index.html': { file: 'assets/new.js', assets: files.map((file) => `assets/${file}`) } });
      }
      if (!url.includes('/assets/')) return htmlResponse();
      active++;
      fetched++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (failAsset && url.endsWith('new.js')) throw new Error('offline');
      return new Response('asset');
    });
    expect(await (await worker.navigation()).text()).toBe(html());
    expect(peak).toBe(6);
    expect(active).toBe(0);
    expect(fetched).toBe(58);
    const assets = await worker.caches.open(assetName);
    for (const file of files) {
      if (failAsset && file === 'new.js') expect(await assets.match(`/assets/${file}`)).toBeUndefined();
      else expect(await assets.match(`/assets/${file}`)).toBeDefined();
    }
    expect(await (await cache.match('/index.html'))?.text()).toBe(html(failAsset ? 'old' : 'new'));
  });

  it('does not replace a complete offline shell when an asset download fails', async () => {
    const worker = setup();
    await (await worker.caches.open(shellName)).put('/index.html', htmlResponse('old'));
    const originalFetch = worker.fetch.getMockImplementation()!;
    worker.fetch.mockImplementation(async (input) => String(input).endsWith('lazy.js') ? new Response('missing', { status: 404 }) : originalFetch(input));
    expect(await (await worker.navigation()).text()).toBe(html());
    expect(await (await (await worker.caches.open(shellName)).match('/index.html'))?.text()).toBe(html('old'));
    await expect(worker.dispatch('install').done()).rejects.toThrow('asset unavailable');
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('rejects mismatched HTML/manifest and does not cache a maintenance page', async () => {
    const worker = setup();
    const originalFetch = worker.fetch.getMockImplementation()!;
    worker.fetch.mockImplementation(async (input) => String(input).endsWith('manifest.json') ? originalFetch(input) : htmlResponse('other'));
    await expect(worker.dispatch('install').done()).rejects.toThrow('mismatch');
    expect(await (await worker.caches.open(shellName)).match('/index.html')).toBeUndefined();
  });

  it('keeps HTTP failures authoritative instead of falling back', async () => {
    const worker = setup();
    await (await worker.caches.open(shellName)).put('/index.html', htmlResponse('old'));
    worker.fetch.mockResolvedValue(new Response('maintenance', { status: 503 }));
    expect((await worker.navigation()).status).toBe(503);
  });

  it('removes only its old cache names and preserves old assets on activation', async () => {
    const worker = setup();
    await (await worker.caches.open('mobile-app-shell-v0-assets')).put('/assets/old.js', new Response('old'));
    await worker.caches.open('mobile-app-shell-v0-shell');
    await worker.caches.open('unrelated-cache');
    await worker.dispatch('activate').done();
    expect(await worker.caches.keys()).toEqual(expect.arrayContaining(['unrelated-cache', assetName]));
    expect(await worker.caches.keys()).not.toContain('mobile-app-shell-v0-assets');
    expect(await worker.caches.keys()).not.toContain('mobile-app-shell-v0-shell');
    expect(await (await worker.caches.open(assetName)).match('/assets/old.js')).toBeDefined();
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });
});
