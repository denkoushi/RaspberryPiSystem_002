import { useLayoutEffect, useState } from 'react';

import { api } from '../../api/client';

const MAX_CACHE_ENTRIES = 30;

const ALLOWED_DERIVATIVE_WIDTHS = [1280, 1920, 2560] as const;

export type PartMeasurementDrawingBlobUrlOptions = {
  displayWidth?: number;
};

type CacheEntry = {
  blobUrl: string;
  refCount: number;
};

const drawingBlobCache = new Map<string, CacheEntry>();
const pendingFetches = new Map<string, Promise<string>>();

/**
 * キオスク表示用: 画面幅と devicePixelRatio から派生画像の要求幅へスナップする。
 */
export function resolveKioskDrawingDisplayWidth(): number {
  const raw = Math.min(2560, Math.ceil(window.innerWidth * window.devicePixelRatio));
  if (raw <= 1280) return 1280;
  if (raw <= 1920) return 1920;
  return 2560;
}

/** @internal test helper */
export function snapDisplayWidthToDerivativeWidth(displayWidth: number): number {
  const capped = Math.min(2560, Math.ceil(displayWidth));
  for (const width of ALLOWED_DERIVATIVE_WIDTHS) {
    if (capped <= width) {
      return width;
    }
  }
  return 2560;
}

/**
 * `/api/storage/...` の図面を x-client-key 付きで取得し、Blob URL を返す。
 * `<img src>` ではヘッダを付けられないためこの方式を使う。
 *
 * パス変更時は取得完了まで blobUrl を null にし、旧図面と新測定点の重なりを防ぐ。
 * キャッシュヒット時は即座に blobUrl を返す。
 */
export function usePartMeasurementDrawingBlobUrl(
  drawingImageRelativePath: string | null | undefined,
  options?: PartMeasurementDrawingBlobUrlOptions
): {
  blobUrl: string | null;
  error: string | null;
} {
  const displayWidth = options?.displayWidth;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    let heldKey: string | null = null;

    const releaseHeld = () => {
      if (!heldKey) return;
      releaseDrawingBlobCacheRef(heldKey);
      heldKey = null;
    };

    const trimmedPath = drawingImageRelativePath?.trim();
    if (!trimmedPath) {
      releaseHeld();
      setBlobUrl(null);
      setError(null);
      return;
    }

    const cacheKey = buildDrawingCacheKey(trimmedPath, displayWidth);
    releaseHeld();

    const cachedBlobUrl = getCachedDrawingBlobUrl(cacheKey);
    if (cachedBlobUrl) {
      acquireDrawingBlobCacheRef(cacheKey);
      heldKey = cacheKey;
      setBlobUrl(cachedBlobUrl);
      setError(null);
      return releaseHeld;
    }

    setBlobUrl(null);
    setError(null);

    void (async () => {
      try {
        const url = await fetchDrawingBlobUrl(cacheKey);
        if (cancelled) return;
        acquireDrawingBlobCacheRef(cacheKey);
        heldKey = cacheKey;
        setBlobUrl(url);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
          setError('図面の読み込みに失敗しました');
        }
      }
    })();

    return () => {
      cancelled = true;
      releaseHeld();
    };
  }, [drawingImageRelativePath, displayWidth]);

  return { blobUrl, error };
}

/** @internal test helper */
export function __resetPartMeasurementDrawingBlobUrlCacheForTests(): void {
  for (const entry of drawingBlobCache.values()) {
    revokePartMeasurementDrawingBlobUrl(entry.blobUrl);
  }
  drawingBlobCache.clear();
  pendingFetches.clear();
}

function normalizeDrawingImagePath(drawingImageRelativePath: string): string {
  return drawingImageRelativePath.replace(/^\/api\//, '');
}

function buildDrawingCacheKey(
  drawingImageRelativePath: string,
  displayWidth?: number
): string {
  const normalizedPath = normalizeDrawingImagePath(drawingImageRelativePath);
  if (displayWidth == null) {
    return normalizedPath;
  }
  const derivativeWidth = snapDisplayWidthToDerivativeWidth(displayWidth);
  return `${normalizedPath}?w=${derivativeWidth}`;
}

function getCachedDrawingBlobUrl(cacheKey: string): string | null {
  const entry = drawingBlobCache.get(cacheKey);
  if (!entry) return null;

  drawingBlobCache.delete(cacheKey);
  drawingBlobCache.set(cacheKey, entry);
  return entry.blobUrl;
}

function acquireDrawingBlobCacheRef(cacheKey: string): void {
  const entry = drawingBlobCache.get(cacheKey);
  if (!entry) return;

  entry.refCount += 1;
  drawingBlobCache.delete(cacheKey);
  drawingBlobCache.set(cacheKey, entry);
}

function releaseDrawingBlobCacheRef(cacheKey: string): void {
  const entry = drawingBlobCache.get(cacheKey);
  if (!entry) return;

  entry.refCount = Math.max(0, entry.refCount - 1);
  evictDrawingBlobCacheIfNeeded();
}

function ensureDrawingBlobCacheEntry(cacheKey: string, blobUrl: string): void {
  if (drawingBlobCache.has(cacheKey)) return;

  drawingBlobCache.set(cacheKey, { blobUrl, refCount: 0 });
  evictDrawingBlobCacheIfNeeded();
}

function evictDrawingBlobCacheIfNeeded(): void {
  while (drawingBlobCache.size > MAX_CACHE_ENTRIES) {
    let evicted = false;

    for (const [cacheKey, entry] of drawingBlobCache) {
      if (entry.refCount > 0) continue;

      drawingBlobCache.delete(cacheKey);
      revokePartMeasurementDrawingBlobUrl(entry.blobUrl);
      evicted = true;
      break;
    }

    if (!evicted) break;
  }
}

async function fetchDrawingBlobUrl(cacheKey: string): Promise<string> {
  const cachedBlobUrl = getCachedDrawingBlobUrl(cacheKey);
  if (cachedBlobUrl) return cachedBlobUrl;

  const inFlight = pendingFetches.get(cacheKey);
  if (inFlight) return inFlight;

  const fetchPromise = (async () => {
    const { data } = await api.get<Blob>(cacheKey, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(data);
    ensureDrawingBlobCacheEntry(cacheKey, blobUrl);
    return drawingBlobCache.get(cacheKey)?.blobUrl ?? blobUrl;
  })();

  pendingFetches.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    pendingFetches.delete(cacheKey);
  }
}

function revokePartMeasurementDrawingBlobUrl(url: string): void {
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}
