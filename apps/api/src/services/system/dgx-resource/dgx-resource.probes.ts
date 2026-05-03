export type MetricsPayload = {
  gpuUtilPct?: number;
  unifiedMemoryUsedGiB?: number;
  unifiedMemoryTotalGiB?: number;
  freeMemoryGiB?: number;
};

export const createTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

export async function fetchJsonMetrics(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<MetricsPayload | undefined> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', signal });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return undefined;
    const o = body as Record<string, unknown>;
    const toNum = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const payload: MetricsPayload = {
      gpuUtilPct: toNum(o.gpuUtilPct ?? o.gpu_util_pct),
      unifiedMemoryUsedGiB: toNum(o.unifiedMemoryUsedGiB ?? o.unified_memory_used_gib),
      unifiedMemoryTotalGiB: toNum(o.unifiedMemoryTotalGiB ?? o.unified_memory_total_gib),
      freeMemoryGiB: toNum(o.freeMemoryGiB ?? o.free_memory_gib),
    };
    const hasAtLeastOneMetric = Object.values(payload).some((value) => value !== undefined);
    return hasAtLeastOneMetric ? payload : undefined;
  } catch {
    return undefined;
  } finally {
    cleanup();
  }
}

export async function probeHttpOk(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<boolean> {
  const r = await probeHttpGet(url, fetchImpl, timeoutMs, headers);
  return r.ok;
}

export async function probeHttpGet(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<{ ok: boolean; statusCode?: number; errorBrief?: string }> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal });
    const ok = response.ok;
    const statusCode = response.status;
    return {
      ok,
      statusCode,
      ...(ok ? {} : { errorBrief: `HTTP ${statusCode}` }),
    };
  } catch (e: unknown) {
    const aborted = typeof e === 'object' && e != null && (e as { name?: string }).name === 'AbortError';
    return { ok: false, errorBrief: aborted ? 'timeout_or_abort' : 'network_or_error' };
  } finally {
    cleanup();
  }
}

export async function probeV1Models(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<{ ok: boolean; statusCode?: number; inferenceHint?: string }> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const url = new URL('/v1/models', baseUrl);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'X-LLM-Token': token },
      signal,
    });
    let inferenceHint: string | undefined;
    if (response.ok) {
      try {
        const body: unknown = await response.clone().json();
        if (body && typeof body === 'object') {
          const o = body as Record<string, unknown>;
          const root = typeof o.root === 'string' ? o.root : undefined;
          const data = o.data;
          const first =
            Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null
              ? (data[0] as Record<string, unknown>)
              : undefined;
          const modelId = typeof first?.id === 'string' ? first.id : undefined;
          const modelRoot = typeof first?.root === 'string' ? first.root : undefined;
          const parts = [modelId ?? modelRoot, root].filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
          if (parts.length > 0) {
            inferenceHint = parts.slice(0, 2).join(' · ');
          }
        }
      } catch {
        /* optional parse */
      }
    }
    return { ok: response.ok, statusCode: response.status, ...(inferenceHint ? { inferenceHint } : {}) };
  } catch {
    return { ok: false };
  } finally {
    cleanup();
  }
}
