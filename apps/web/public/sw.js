/* Classic worker: keep this file dependency-free; tests execute the shipped script. */
const CACHE_PREFIX = 'mobile-app-shell-';
const SHELL_CACHE = `${CACHE_PREFIX}v1-shell`;
const ASSET_CACHE = `${CACHE_PREFIX}v1-assets`;
const INDEX_URL = '/index.html';
const SHELL_ASSETS_URL = '/app-shell-assets.json';
const BUILD_MANIFEST = '/app-shell-manifest.json';
const NETWORK_TIMEOUT_MS = 4000;
const ASSET_FETCH_CONCURRENCY = 6;
let shellUpdate = Promise.resolve();
const assetFetches = new Map();

function isMobilePath(pathname) {
  return pathname === '/kiosk/mobile-placement' ||
    pathname.startsWith('/kiosk/mobile-placement/') ||
    pathname === '/kiosk/purchase-order-lookup' || pathname === '/kiosk/purchase-order-lookup/';
}

function routeRequest(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return null;
  if (request.mode === 'navigate') return isMobilePath(url.pathname) ? 'navigation' : null;
  return url.pathname.startsWith('/assets/') ? 'asset' : null;
}

async function serveAsset(event) {
  // Scope also controls other kiosk windows after claim. Their assets must stay untouched.
  const client = event.clientId ? await self.clients.get(event.clientId) : undefined;
  if (!client) return fetch(event.request);
  const url = new URL(client.url);
  if (url.origin !== self.location.origin || !isMobilePath(url.pathname)) return fetch(event.request);
  return cacheAsset(event.request, false, event);
}

async function fetchWithTimeout(input, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetch(input, { cache: 'no-store', signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('App shell network timeout'));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function directlyReferencedAssets(html) {
  const urls = new Set();
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const value = tag[0].match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!value) continue;
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) urls.add(url.href);
  }
  return urls;
}

function referencedAssets(html, manifest) {
  const urls = directlyReferencedAssets(html);
  const entry = manifest['index.html'];
  if (!entry || !urls.has(new URL(entry.file, self.location.origin).href)) {
    throw new Error('HTML/build manifest mismatch');
  }
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error('Missing app shell chunk');
    for (const file of [chunk.file, ...(chunk.css || []), ...(chunk.assets || [])]) {
      const url = new URL(file, self.location.origin);
      if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) {
        throw new Error('Invalid app shell asset');
      }
      urls.add(url.href);
    }
    for (const dependency of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) visit(dependency);
  }
  visit('index.html');
  return urls;
}

function isHtml(response) {
  return response.ok && !response.redirected &&
    response.headers.get('content-type')?.includes('text/html');
}

async function fetchAsset(request) {
  const url = new URL(typeof request === 'string' ? request : request.url, self.location.origin).href;
  let pending = assetFetches.get(url);
  if (!pending) {
    pending = fetchWithTimeout(request, 30_000).finally(() => assetFetches.delete(url));
    assetFetches.set(url, pending);
  }
  return (await pending).clone();
}

async function cacheAsset(request, strict = false, event) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetchAsset(request);
  // A maintenance/SPA fallback is not a JavaScript/CSS asset.
  if (!response.ok || response.redirected || response.headers.get('content-type')?.includes('text/html')) {
    if (strict) throw new Error('App shell asset unavailable');
    return response;
  }
  const write = cache.put(request, response.clone());
  if (strict) await write;
  else {
    const saving = write.catch(() => {});
    if (event) event.waitUntil(saving);
  }
  return response;
}

async function saveShell(response, navigationEvent) {
  if (!isHtml(response)) return;
  const html = await response.clone().text();
  const manifestResponse = await fetchWithTimeout(BUILD_MANIFEST);
  if (!manifestResponse.ok) throw new Error('App shell manifest unavailable');
  const assets = referencedAssets(html, await manifestResponse.json());
  // Commit the HTML last: an interrupted download leaves the previous offline shell usable.
  const pendingAssets = assets.values();
  let failure;
  await Promise.all(Array.from({ length: ASSET_FETCH_CONCURRENCY }, async () => {
    for (const url of pendingAssets) {
      try {
        await cacheAsset(url, true);
      } catch (error) {
        failure = error;
      }
    }
  }));
  if (failure) throw failure;
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(INDEX_URL, response);
  // Pair the list with its HTML so an interrupted metadata write cannot collect
  // lazy chunks using the previous shell's list.
  await cache.put(SHELL_ASSETS_URL, new Response(JSON.stringify({ html, assets: [...assets] }),
    { headers: { 'content-type': 'application/json' } }));
  if (!navigationEvent) return;
  await collectAssets(assets, navigationEvent);
}

async function collectAssets(assets, navigationEvent) {
  // Keep every file used by the served shell, including its lazy chunks. Other
  // windows (including uncontrolled ones) may still need older files.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows.some((client) => client.id !== navigationEvent.resultingClientId)) return;
  const assetCache = await caches.open(ASSET_CACHE);
  for (const key of await assetCache.keys()) {
    if (!assets.has(key.url)) await assetCache.delete(key);
  }
}

function queueShellSave(response, event) {
  const update = shellUpdate.catch(() => {}).then(() => saveShell(response, event));
  shellUpdate = update;
  return update;
}

async function navigate(event) {
  const url = new URL(event.request.url);
  if (isMobilePath(url.pathname) && !url.searchParams.has('__raspi_kiosk_web_release') &&
      !url.searchParams.has('__raspi_web_runtime_recovery')) {
    try {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(INDEX_URL);
      if (cached) {
        const html = await cached.clone().text();
        const assets = await caches.open(ASSET_CACHE);
        const present = await Promise.all([...directlyReferencedAssets(html)].map((asset) => assets.match(asset)));
        if (present.every(Boolean)) {
          // Capture this shell's list before the background save replaces it.
          shellUpdate = shellUpdate.catch(() => {}).then(async () => {
            // Re-read after earlier queued saves: collect only while the served shell is
            // still the committed one, and never while another worker may be filling the
            // shared asset cache for a newer shell.
            if (self.registration?.installing || self.registration?.waiting) return;
            const current = await cache.match(INDEX_URL);
            const stored = await cache.match(SHELL_ASSETS_URL);
            if (!current || !stored || (await current.text()) !== html) return;
            const list = await stored.json();
            if (list.html === html) await collectAssets(new Set(list.assets), event);
          });
          event.waitUntil(shellUpdate.catch(() => {}));
          event.waitUntil(fetch(event.request, { cache: 'no-store' }).then((response) =>
            queueShellSave(response.clone(), undefined)
          ).catch(() => {}));
          // Cached HTML wins over navigation maintenance/HTTP-error HTML. API-driven
          // isMaintenance and release verification still apply to the running shell.
          return cachedShellResponse(cached);
        }
      }
    } catch {
      // Cache failures leave the existing network-first path available.
    }
  }
  const network = fetch(event.request, { cache: 'no-store' });
  let timedOut = false;
  let timer;
  // Keep the original fetch alive after fallback, without collecting assets still
  // used by the old shell. Storage/network failures must not affect navigation.
  event.waitUntil(network.then((response) =>
    queueShellSave(response.clone(), timedOut ? undefined : event)
  ).catch(() => {}));
  let response;
  try {
    response = await Promise.race([
      network,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('App shell network timeout'));
        }, NETWORK_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(INDEX_URL);
    if (!cached) throw error;
    return cachedShellResponse(cached);
  } finally {
    clearTimeout(timer);
  }
  // HTTP errors/maintenance responses remain authoritative. Storage failures must
  // not turn a successful online navigation into a stale response or a blank page.
  return response;
}

async function cachedShellResponse(cached) {
  // The marker only skips blocking mount on deploy-status, even while online.
  // API-driven maintenance and release-verification reloads still apply.
  const html = (await cached.text()).replace('</head>',
    '<meta name="mobile-app-shell-offline" content="true"></head>');
  const headers = new Headers(cached.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(html, { status: 200, headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const response = await fetchWithTimeout(INDEX_URL);
    if (!isHtml(response)) throw new Error('App shell HTML unavailable');
    await queueShellSave(response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const currentAssets = await caches.open(ASSET_CACHE);
    for (const name of await caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX) || name === SHELL_CACHE || name === ASSET_CACHE) continue;
      // Carry hashed files forward before deleting old names so already open/offline
      // clients survive a worker upgrade. The next safe online collection removes them.
      if (name.endsWith('-assets')) {
        const old = await caches.open(name);
        for (const key of await old.keys()) {
          if (!(await currentAssets.match(key))) await currentAssets.put(key, await old.match(key));
        }
      }
      await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const route = routeRequest(event.request);
  if (route === 'navigation') event.respondWith(navigate(event));
  if (route === 'asset') event.respondWith(serveAsset(event));
});
