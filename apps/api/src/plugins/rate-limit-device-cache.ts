type DeviceCacheOptions = {
  lookup: (apiKey: string) => Promise<{ id: string } | null>;
  now?: () => number;
};

export const createRateLimitDeviceCache = ({ lookup, now = Date.now }: DeviceCacheOptions) => {
  const entries = new Map<string, { deviceId: string | null; expiresAt: number }>();

  return async (apiKey: string): Promise<string | null> => {
    const cached = entries.get(apiKey);
    if (cached && cached.expiresAt > now()) return cached.deviceId;
    entries.delete(apiKey);

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
