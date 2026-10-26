/* Classic worker: keep this file dependency-free; tests execute the shipped script. */
const CACHE_PREFIX = 'mobile-app-shell-';
const SHELL_CACHE = `${CACHE_PREFIX}v1-shell`;
const ASSET_CACHE = `${CACHE_PREFIX}v1-assets`;
const INDEX_URL = '/index.html';
const BUILD_MANIFEST = '/app-shell-manifest.json';
const NETWORK_TIMEOUT_MS = 4000;
const ASSET_FETCH_CONCURRENCY = 6;
let shellUpdate = Promise.resolve();

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
  return cacheAsset(event.request);
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

function referencedAssets(html, manifest) {
  const urls = new Set();
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const value = tag[0].match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!value) continue;
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) urls.add(url.href);
  }
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

async function cacheAsset(request, strict = false) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetchWithTimeout(request, 30_000);
  // A maintenance/SPA fallback is not a JavaScript/CSS asset.
  if (!response.ok || response.redirected || response.headers.get('content-type')?.includes('text/html')) {
    if (strict) throw new Error('App shell asset unavailable');
    return response;
  }
  const write = cache.put(request, response.clone());
  if (strict) await write;
  else await write.catch(() => {});
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
  if (!navigationEvent) return;
  // Only collect after a successful online load with no other open windows (including
  // uncontrolled ones). Never collect on offline fallback or while an older tab is open.
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
    // Boot can bypass only the mobile deploy-status wait even when navigator.onLine
    // remains true (for example a disconnected VPN). API responses are never cached.
    const html = (await cached.text()).replace('</head>',
      '<meta name="mobile-app-shell-offline" content="true"></head>');
    const headers = new Headers(cached.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(html, { status: 200, headers });
  } finally {
    clearTimeout(timer);
  }
  // HTTP errors/maintenance responses remain authoritative. Storage failures must
  // not turn a successful online navigation into a stale response or a blank page.
  return response;
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
