type AutoRotationVmCacheEntry<T> = {
  expiresAt: number;
  value: Promise<T>;
};

const autoRotationVmCache = new Map<string, AutoRotationVmCacheEntry<unknown>>();

export function getAutoRotationVmCache<T>(
  key: string,
  now: number
): Promise<T> | null {
  const cached = autoRotationVmCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= now) {
    autoRotationVmCache.delete(key);
    return null;
  }
  return cached.value as Promise<T>;
}

export function setAutoRotationVmCache<T>(
  key: string,
  expiresAt: number,
  value: Promise<T>
): void {
  autoRotationVmCache.set(key, {
    expiresAt,
    value,
  });
  value.catch(() => {
    const current = autoRotationVmCache.get(key);
    if (current?.value === value) {
      autoRotationVmCache.delete(key);
    }
  });
}

export function clearAutoRotationVmCache(): void {
  autoRotationVmCache.clear();
}
