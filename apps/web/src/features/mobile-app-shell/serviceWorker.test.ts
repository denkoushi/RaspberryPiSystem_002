// @vitest-environment node
import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import workerSource from '../../../public/sw.js?raw';

const origin = 'https://factory.test';
const shellName = 'mobile-app-shell-v1-shell';
const assetName = 'mobile-app-shell-v1-assets';
const shellAssetsUrl = '/app-shell-assets.json';
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

async function seedShell(worker: ReturnType<typeof setup>, withList = false) {
  const cache = await worker.caches.open(shellName);
  await cache.put('/index.html', htmlResponse('old'));
  const assets = await worker.caches.open(assetName);
  const files = ['old.js', 'app.css', 'old-lazy.js'];
  for (const file of files) await assets.put(`/assets/${file}`, new Response(file));
  if (withList) {
    await cache.put(shellAssetsUrl, Response.json({
      html: html('old'), assets: files.map((file) => `${origin}/assets/${file}`)
    }));
  }
}

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

  it('uses the network without cached HTML, saves it and collects unused assets with no other windows', async () => {
    const worker = setup();
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

  it('serves cached HTML with the marker immediately even when the network never settles', async () => {
    vi.useFakeTimers();
    const worker = setup();
    await seedShell(worker);
    worker.fetch.mockImplementation(() => new Promise(() => {}));
    const { event } = worker.dispatch('fetch');
    const response = event.respondWith.mock.calls[0][0];
    const body = await (await response).text();
    expect(body).toContain('/assets/old.js');
    expect(body).toContain('<meta name="mobile-app-shell-offline" content="true">');
    expect(vi.getTimerCount()).toBe(0);
    expect(worker.fetch).toHaveBeenCalledExactlyOnceWith(event.request, { cache: 'no-store' });
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
  });

  it('refreshes HTML for the next launch without collecting old-shell assets when the list is missing', async () => {
    const worker = setup();
    const cache = await worker.caches.open(shellName);
    const assets = await worker.caches.open(assetName);
    await seedShell(worker);
    let resolveNetwork!: (response: Response) => void;
    worker.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveNetwork = resolve; }));
    const { event, done } = worker.dispatch('fetch');
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toContain('/assets/old.js');
    let saved = false;
    const saving = done().then(() => { saved = true; });
    expect(saved).toBe(false);
    expect(await (await cache.match('/index.html'))?.text()).toBe(html('old'));
    expect(worker.fetch).toHaveBeenCalledExactlyOnceWith(event.request, { cache: 'no-store' });

    resolveNetwork(htmlResponse());
    await saving;
    expect(await (await cache.match('/index.html'))?.text()).toBe(html());
    expect(await assets.match('/assets/new.js')).toBeDefined();
    expect(await assets.match('/assets/old.js')).toBeDefined();
    expect(await assets.match('/assets/old-lazy.js')).toBeDefined();
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
    worker.fetch.mockRejectedValue(new Error('offline'));
    expect(await (await worker.navigation()).text()).toContain('/assets/new.js');
  });

  it.each([0, 5000])('does not save when navigation fails offline after %i ms', async (delay) => {
    vi.useFakeTimers();
    const worker = setup();
    const cache = await worker.caches.open(shellName);
    await seedShell(worker);
    worker.fetch.mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('offline')), delay);
    }));
    const { event, done } = worker.dispatch('fetch');
    await vi.advanceTimersByTimeAsync(Math.max(4000, delay));
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toContain('/assets/old.js');
    await done();
    expect(worker.fetch).toHaveBeenCalledOnce();
    expect(await (await cache.match('/index.html'))?.text()).toBe(html('old'));
    expect(await (await worker.caches.open(assetName)).keys()).toHaveLength(3);
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

  it('keeps HTTP failures authoritative without cached HTML', async () => {
    const worker = setup();
    worker.fetch.mockResolvedValue(new Response('maintenance', { status: 503 }));
    expect((await worker.navigation()).status).toBe(503);
  });

  it.each([200, 503])('prefers cached HTML over navigation maintenance HTML (status %i)', async (status) => {
    const worker = setup();
    await seedShell(worker);
    worker.fetch.mockResolvedValue(new Response('maintenance', { status, headers: { 'content-type': 'text/html' } }));
    const response = await worker.navigation();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/assets/old.js');
    expect(await (await (await worker.caches.open(shellName)).match('/index.html'))?.text()).toBe(html('old'));
  });

  it.each(['__raspi_kiosk_web_release', '__raspi_web_runtime_recovery'])('uses the network for %s even with a complete cache', async (param) => {
    const worker = setup();
    await seedShell(worker, true);
    const { event, done } = worker.dispatch('fetch', `/kiosk/mobile-placement?${param}=`);
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe(html());
    await done();
    expect(await (await worker.caches.open(assetName)).match('/assets/old.js')).toBeUndefined();
  });

  it.each(['old.js', 'app.css'])('uses the network when the cached shell is missing %s', async (file) => {
    const worker = setup();
    await seedShell(worker, true);
    await (await worker.caches.open(assetName)).delete(`/assets/${file}`);
    expect(await (await worker.navigation()).text()).toBe(html());
  });

  it('retains the four-second fallback on the network-first path', async () => {
    vi.useFakeTimers();
    const worker = setup();
    await seedShell(worker, true);
    worker.fetch.mockImplementation(() => new Promise(() => {}));
    const { event } = worker.dispatch('fetch', '/kiosk/mobile-placement?__raspi_kiosk_web_release=next');
    let settled = false;
    const response = event.respondWith.mock.calls[0][0].then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const body = await (await response).text();
    expect(body).toContain('/assets/old.js');
    expect(body).toContain('name="mobile-app-shell-offline"');
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
  });

  it.each([false, true])('collects only before refresh using the served shell list (other window: %s)', async (otherWindow) => {
    const worker = setup();
    await seedShell(worker, true);
    worker.self.clients.matchAll.mockResolvedValue(otherWindow
      ? [{ id: 'new-window' }, { id: 'other-window' }] : [{ id: 'new-window' }]);
    const assets = await worker.caches.open(assetName);
    await assets.put('/assets/unused.js', new Response('unused'));
    let finishCollection!: () => void;
    const collecting = new Promise<void>((resolve) => { finishCollection = resolve; });
    const originalOpen = worker.caches.open;
    const deleted: string[] = [];
    vi.spyOn(worker.caches, 'open').mockImplementation(async (name) => {
      const cache = await originalOpen(name);
      if (name === assetName) return { ...cache, delete: async (input) => {
        deleted.push(typeof input === 'string' ? input : input.url);
        await collecting;
        return cache.delete(input);
      } };
      return cache;
    });
    const { event, done } = worker.dispatch('fetch');
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toContain('/assets/old.js');
    if (!otherWindow) {
      await vi.waitFor(() => expect(deleted).toEqual([`${origin}/assets/unused.js`]));
      // Even an immediate HTML fetch cannot start saving while collection is pending.
      expect(worker.fetch).toHaveBeenCalledOnce();
    }
    finishCollection();
    await done();
    expect(worker.self.clients.matchAll).toHaveBeenCalledExactlyOnceWith({ type: 'window', includeUncontrolled: true });
    expect(Boolean(await assets.match('/assets/unused.js'))).toBe(otherWindow);
    for (const file of ['old.js', 'old-lazy.js', 'new.js', 'lazy.js']) {
      expect(await assets.match(`/assets/${file}`)).toBeDefined();
    }
    const stored = await (await (await worker.caches.open(shellName)).match(shellAssetsUrl))?.json();
    expect(stored.html).toBe(html());
    expect(stored.assets.sort()).toEqual(['new.js', 'vendor.js', 'lazy.js', 'app.css', 'font.woff2'].map((file) => `${origin}/assets/${file}`).sort());
  });

  it('does not collect a newer shell saved while a later launch still served the old one', async () => {
    const worker = setup();
    await seedShell(worker, true);
    const originalFetch = worker.fetch.getMockImplementation()!;
    let finishAsset!: () => void;
    const assetGate = new Promise<void>((resolve) => { finishAsset = resolve; });
    let navigations = 0;
    worker.fetch.mockImplementation(async (input) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (url.endsWith('/assets/new.js')) await assetGate;
      // The second launch's refresh fails, so nothing re-downloads collected files.
      if (url.endsWith('/kiosk/mobile-placement') && ++navigations > 1) throw new Error('offline');
      return originalFetch(input);
    });
    const first = worker.dispatch('fetch');
    await first.event.respondWith.mock.calls[0][0];
    await vi.waitFor(() => expect(worker.fetch.mock.calls.some(([input]) => String(input).endsWith('/assets/new.js'))).toBe(true));
    const second = worker.dispatch('fetch');
    expect(await (await second.event.respondWith.mock.calls[0][0]).text()).toContain('/assets/old.js');
    finishAsset();
    await first.done();
    await second.done();
    const assets = await worker.caches.open(assetName);
    for (const file of ['new.js', 'vendor.js', 'lazy.js', 'app.css', 'font.woff2']) {
      expect(await assets.match(`/assets/${file}`)).toBeDefined();
    }
    expect(await (await (await worker.caches.open(shellName)).match('/index.html'))?.text()).toBe(html());
  });

  it('skips collection while another worker is installing', async () => {
    const worker = setup();
    await seedShell(worker, true);
    Object.assign(worker.self, { registration: { installing: {} } });
    const assets = await worker.caches.open(assetName);
    await assets.put('/assets/unused.js', new Response('unused'));
    await worker.navigation();
    expect(await assets.match('/assets/unused.js')).toBeDefined();
  });

  it('skips collection when stored metadata belongs to a different shell', async () => {
    const worker = setup();
    await seedShell(worker, true);
    await (await worker.caches.open(shellName)).put(shellAssetsUrl, Response.json({ html: html('previous'), assets: [] }));
    await worker.navigation();
    expect(worker.self.clients.matchAll).not.toHaveBeenCalled();
    expect(await (await worker.caches.open(assetName)).match('/assets/old-lazy.js')).toBeDefined();
  });

  it.each([false, true])('returns non-strict assets before cache writes settle (write fails: %s)', async (failWrite) => {
    const worker = setup();
    let finishWrite!: () => void;
    const writing = new Promise<void>((resolve, reject) => {
      finishWrite = () => failWrite ? reject(new Error('quota')) : resolve();
    });
    const originalOpen = worker.caches.open;
    vi.spyOn(worker.caches, 'open').mockImplementation(async (name) => ({
      ...await originalOpen(name), put: () => writing
    }));
    const { event, done } = worker.dispatch('fetch', '/assets/new.js', { mode: 'cors' });
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('asset');
    let saved = false;
    const saving = done().then(() => { saved = true; });
    await Promise.resolve();
    expect(saved).toBe(false);
    finishWrite();
    await saving;
    expect(saved).toBe(true);
  });

  it('returns a page asset without waiting for its cache write', async () => {
    const worker = setup();
    const open = worker.caches.open;
    let finishPut!: () => void;
    vi.spyOn(worker.caches, 'open').mockImplementation(async (name: string) => {
      const cache = await open(name);
      return name === assetName ? { ...cache, put: (input: string | { url: string }, response: Response) =>
        new Promise<void>((resolve) => { finishPut = () => void cache.put(input, response).then(resolve); }) } : cache;
    });
    const { event, done } = worker.dispatch('fetch', '/assets/new.js', { mode: 'cors' });
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('asset');
    finishPut();
    await done();
    expect(await (await open(assetName)).match('/assets/new.js')).toBeDefined();
  });

  it('deduplicates concurrent page and shell asset fetches with independently readable responses', async () => {
    const worker = setup();
    const originalFetch = worker.fetch.getMockImplementation()!;
    let finishFetch!: (response: Response) => void;
    worker.fetch.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/assets/new.js')) return new Promise((resolve) => { finishFetch = resolve; });
      return originalFetch(input);
    });
    const { event, done } = worker.dispatch('fetch', '/assets/new.js', { mode: 'cors' });
    await vi.waitFor(() => expect(finishFetch).toBeDefined());
    const install = worker.dispatch('install');
    // The manifest's other assets have all started, so its entry fetch is also pending.
    await vi.waitFor(() => expect(worker.fetch.mock.calls.some(([input]) => String(input).endsWith('/assets/lazy.js'))).toBe(true));
    finishFetch(new Response('shared asset'));
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe('shared asset');
    await done();
    await install.done();
    const calls = worker.fetch.mock.calls.filter(([input]) => (typeof input === 'string' ? input : input.url).endsWith('/assets/new.js'));
    expect(calls).toHaveLength(1);
    const assets = await worker.caches.open(assetName);
    expect(await (await assets.match('/assets/new.js'))?.text()).toBe('shared asset');
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    // Settled fetches leave the map; an eviction can fetch the URL again.
    await assets.delete('/assets/new.js');
    worker.fetch.mockImplementation(originalFetch);
    const next = worker.dispatch('fetch', '/assets/new.js', { mode: 'cors' });
    expect(await (await next.event.respondWith.mock.calls[0][0]).text()).toBe('asset');
    await next.done();
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
