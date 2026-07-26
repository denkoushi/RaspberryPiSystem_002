import { useLayoutEffect, useState } from 'react';

import { api } from '../api/client';

export const PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES = 12;

type CacheEntry = {
  blobUrl: string;
  refCount: number;
};

const cache = new Map<string, CacheEntry>();
const inFlightFetches = new Map<string, Promise<string>>();

function normalizePath(path: string): string {
  return path.replace(/^\/api\//, '');
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

function revoke(blobUrl: string): void {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(blobUrl);
}

function evict(): void {
  while (cache.size > PROTECTED_IMAGE_BLOB_CACHE_MAX_ENTRIES) {
    let removed = false;
    for (const [path, entry] of cache) {
      if (entry.refCount > 0) continue;
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
 * Protected procedure images share a 12-entry LRU. Concurrent consumers of
 * the same source page share one request and one Blob URL; visible entries are
 * retained until their final consumer releases them.
 */
export function useProtectedImageBlobUrl(imagePath: string | null | undefined): {
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
    const cached = touch(path);
    if (cached) {
      acquire(path);
      heldPath = path;
      setBlobUrl(cached);
      return releaseHeld;
    }
    void fetchBlobUrl(path)
      .then((url) => {
        if (cancelled) return;
        acquire(path);
        heldPath = path;
        setBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError('画像の読み込みに失敗しました');
      });
    return () => {
      cancelled = true;
      releaseHeld();
    };
  }, [imagePath]);

  return { blobUrl, error };
}

/** @internal */
export function __resetProtectedImageBlobUrlCacheForTests(): void {
  for (const entry of cache.values()) revoke(entry.blobUrl);
  cache.clear();
  inFlightFetches.clear();
}

/** @internal */
export function __protectedImageBlobCacheSizeForTests(): number {
  return cache.size;
}
