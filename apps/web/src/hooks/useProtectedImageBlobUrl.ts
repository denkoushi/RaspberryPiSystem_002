import { useLayoutEffect, useState } from 'react';

import { api } from '../api/client';

export const PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES = 60;

type CacheEntry = {
  blobUrl: string;
  refCount: number;
};

const cache = new Map<string, CacheEntry>();
const inFlightFetches = new Map<string, Promise<string>>();
const pendingConsumers = new Map<string, number>();

function normalizePath(path: string): string {
  return path.replace(/^\/(?:api\/)?/, '');
}

function touch(path: string): string | null {
  const entry = cache.get(path);
  if (!entry) return null;
  cache.delete(path);
  cache.set(path, entry);
  return entry.blobUrl;
}

function acquire(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  entry.refCount += 1;
  cache.delete(path);
  cache.set(path, entry);
}

function release(path: string): void {
  const entry = cache.get(path);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  evict();
}

function reservePending(path: string): void {
  pendingConsumers.set(path, (pendingConsumers.get(path) ?? 0) + 1);
}

function releasePending(path: string): void {
  const next = (pendingConsumers.get(path) ?? 0) - 1;
  if (next > 0) pendingConsumers.set(path, next);
  else pendingConsumers.delete(path);
}

function revoke(blobUrl: string): void {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(blobUrl);
}

function evict(): void {
  while (cache.size > PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES) {
    let removed = false;
    for (const [path, entry] of cache) {
      if (entry.refCount > 0 || (pendingConsumers.get(path) ?? 0) > 0) continue;
      cache.delete(path);
      revoke(entry.blobUrl);
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

async function fetchBlobUrl(path: string): Promise<string> {
  const cached = touch(path);
  if (cached) return cached;
  const inFlight = inFlightFetches.get(path);
  if (inFlight) return inFlight;
  const request = (async () => {
    const { data } = await api.get<Blob>(path, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(data);
    const existing = touch(path);
    if (existing) {
      revoke(blobUrl);
      return existing;
    }
    cache.set(path, { blobUrl, refCount: 0 });
    evict();
    return blobUrl;
  })();
  inFlightFetches.set(path, request);
  try {
    return await request;
  } finally {
    inFlightFetches.delete(path);
  }
}

/**
 * Protected images share a bounded LRU. Concurrent consumers of
 * the same source page share one request and one Blob URL; visible entries are
 * retained until their final consumer releases them.
 */
export function useProtectedImageBlobUrl(
  imagePath: string | null | undefined,
  refreshIntervalMs?: number
): {
  blobUrl: string | null;
  error: string | null;
} {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    let heldPath: string | null = null;
    const releaseHeld = () => {
      if (heldPath) release(heldPath);
      heldPath = null;
    };
    const trimmed = imagePath?.trim();
    setBlobUrl(null);
    setError(null);
    if (!trimmed) return releaseHeld;
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      setBlobUrl(trimmed);
      return releaseHeld;
    }
    const path = normalizePath(trimmed);
    if (refreshIntervalMs && refreshIntervalMs > 0) {
      let ownedUrl: string | null = null;
      let fetching = false;
      const refresh = async () => {
        if (fetching) return;
        fetching = true;
        try {
          const { data } = await api.get<Blob>(path, {
            responseType: 'blob', params: { _refresh: Date.now() }
          });
          if (cancelled) return;
          const nextUrl = URL.createObjectURL(data);
          const previousUrl = ownedUrl;
          ownedUrl = nextUrl;
          setBlobUrl(nextUrl);
          setError(null);
          if (previousUrl) revoke(previousUrl);
        } catch {
          if (!cancelled) {
            setBlobUrl(null);
            setError('画像の読み込みに失敗しました');
            if (ownedUrl) revoke(ownedUrl);
            ownedUrl = null;
          }
        } finally {
          fetching = false;
        }
      };
      void refresh();
      const timer = setInterval(() => { void refresh(); }, refreshIntervalMs);
      return () => {
        cancelled = true;
        clearInterval(timer);
        if (ownedUrl) revoke(ownedUrl);
      };
    }
    const cached = touch(path);
    if (cached) {
      acquire(path);
      heldPath = path;
      setBlobUrl(cached);
      return releaseHeld;
    }
    reservePending(path);
    void fetchBlobUrl(path)
      .then((url) => {
        if (!cancelled) {
          acquire(path);
          heldPath = path;
          setBlobUrl(url);
        }
        releasePending(path);
        evict();
      })
      .catch(() => {
        releasePending(path);
        evict();
        if (!cancelled) setError('画像の読み込みに失敗しました');
      });
    return () => {
      cancelled = true;
      releaseHeld();
    };
  }, [imagePath, refreshIntervalMs]);

  return { blobUrl, error };
}

/** @internal */
export function __resetProtectedImageBlobUrlCacheForTests(): void {
  for (const entry of cache.values()) revoke(entry.blobUrl);
  cache.clear();
  inFlightFetches.clear();
  pendingConsumers.clear();
}

/** @internal */
export function __protectedImageBlobCacheSizeForTests(): number {
  return cache.size;
}
