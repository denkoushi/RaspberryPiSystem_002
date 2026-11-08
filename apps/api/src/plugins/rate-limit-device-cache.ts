type DeviceCacheOptions = {
  lookup: (apiKey: string) => Promise<{ id: string } | null>;
  now?: () => number;
  maxLookupsPerSource?: number;
};

export const createRateLimitDeviceCache = ({ lookup, now = Date.now, maxLookupsPerSource = 30 }: DeviceCacheOptions) => {
  const entries = new Map<string, { deviceId: string | null; expiresAt: number }>();
  const sources = new Map<string, { lookups: number; expiresAt: number }>();

  return async (apiKey: string, sourceKey: string): Promise<string | null> => {
    const time = now();
    const cached = entries.get(apiKey);
    if (cached && cached.expiresAt > time) return cached.deviceId;
    entries.delete(apiKey);

    let source = sources.get(sourceKey);
    if (!source || source.expiresAt <= time) {
      sources.delete(sourceKey);
      if (sources.size >= 1000) {
        const oldest = sources.keys().next().value;
        if (oldest !== undefined) sources.delete(oldest);
      }
      source = { lookups: 0, expiresAt: time + 60_000 };
      sources.set(sourceKey, source);
    }
    if (source.lookups >= maxLookupsPerSource) return null;
    source.lookups += 1;

    let deviceId: string | null;
    try {
      deviceId = (await lookup(apiKey))?.id ?? null;
    } catch {
      return null;
    }

    entries.delete(apiKey);
    if (entries.size >= 1000) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(apiKey, { deviceId, expiresAt: now() + 60_000 });
    return deviceId;
  };
};
