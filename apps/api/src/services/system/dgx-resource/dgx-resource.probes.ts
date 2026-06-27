export type MetricsPayload = {
  gpuUtilPct?: number;
  gpuTemperatureC?: number;
  gpuPowerDrawW?: number;
  gpuPowerLimitW?: number;
  gpuClockSmMhz?: number;
  gpuClockGraphicsMhz?: number;
  gpuClockMemoryMhz?: number;
  gpuPstate?: string;
  gpuClocksThrottleReason?: string;
  gpuName?: string;
  driverVersion?: string;
  unifiedMemoryUsedGiB?: number;
  unifiedMemoryTotalGiB?: number;
  freeMemoryGiB?: number;
  systemMemoryAvailableGiB?: number;
  startupFreeMemoryGiB?: number;
  memoryMetricSource?: string;
  gpuProcessCount?: number;
  gpuProcessMemoryUsedGiB?: number;
  gpuProcesses?: Array<{
    pid?: number;
    processName?: string;
    usedMemoryGiB?: number;
  }>;
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
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<MetricsPayload | undefined> {
  const { signal, cleanup } = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', signal, ...(headers ? { headers } : {}) });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return undefined;
    const o = body as Record<string, unknown>;
    const toNum = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const toStr = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
    const toGpuProcesses = (v: unknown): MetricsPayload['gpuProcesses'] | undefined => {
      if (!Array.isArray(v)) return undefined;
      const rows = v
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
        .map((item) => ({
          ...(toNum(item.pid) !== undefined ? { pid: Math.trunc(toNum(item.pid)!) } : {}),
          ...(toStr(item.processName ?? item.process_name) ? { processName: toStr(item.processName ?? item.process_name)! } : {}),
          ...(toNum(item.usedMemoryGiB ?? item.used_memory_gib) !== undefined
            ? { usedMemoryGiB: toNum(item.usedMemoryGiB ?? item.used_memory_gib)! }
            : {}),
        }))
        .filter((item) => item.pid !== undefined || item.processName !== undefined || item.usedMemoryGiB !== undefined);
      return rows.length > 0 ? rows : undefined;
    };
    const payload: MetricsPayload = {
      gpuUtilPct: toNum(o.gpuUtilPct ?? o.gpu_util_pct),
      gpuTemperatureC: toNum(
        o.gpuTemperatureC ??
          o.gpu_temperature_c ??
          o.gpuTempC ??
          o.gpu_temp_c ??
          o.temperatureGpuC ??
          o.temperature_gpu_c ??
          o['temperature.gpu']
      ),
      gpuPowerDrawW: toNum(
        o.gpuPowerDrawW ??
          o.gpu_power_draw_w ??
          o.powerDrawW ??
          o.power_draw_w ??
          o.powerDrawWatts ??
          o.power_draw_watts ??
          o['power.draw']
      ),
      gpuPowerLimitW: toNum(
        o.gpuPowerLimitW ??
          o.gpu_power_limit_w ??
          o.powerLimitW ??
          o.power_limit_w ??
          o.powerLimitWatts ??
          o.power_limit_watts ??
          o['power.limit']
      ),
      gpuClockSmMhz: toNum(
        o.gpuClockSmMhz ??
          o.gpu_clock_sm_mhz ??
          o.smClockMhz ??
          o.sm_clock_mhz ??
          o.clockSmMhz ??
          o.clock_sm_mhz ??
          o['clocks.sm']
      ),
      gpuClockGraphicsMhz: toNum(
        o.gpuClockGraphicsMhz ??
          o.gpu_clock_graphics_mhz ??
          o.graphicsClockMhz ??
          o.graphics_clock_mhz ??
          o.clockGraphicsMhz ??
          o.clock_graphics_mhz ??
          o['clocks.gr']
      ),
      gpuClockMemoryMhz: toNum(
        o.gpuClockMemoryMhz ??
          o.gpu_clock_memory_mhz ??
          o.memoryClockMhz ??
          o.memory_clock_mhz ??
          o.clockMemoryMhz ??
          o.clock_memory_mhz ??
          o['clocks.mem']
      ),
      gpuPstate: toStr(o.gpuPstate ?? o.gpu_pstate ?? o.pstate),
      gpuClocksThrottleReason: toStr(
        o.gpuClocksThrottleReason ??
          o.gpu_clocks_throttle_reason ??
          o.clocksThrottleReason ??
          o.clocks_throttle_reason ??
          o['clocks_throttle_reasons.active']
      ),
      gpuName: toStr(o.gpuName ?? o.gpu_name ?? o.gpuModel ?? o.gpu_model ?? o.name),
      driverVersion: toStr(o.driverVersion ?? o.driver_version ?? o.nvidiaDriverVersion ?? o.nvidia_driver_version),
      unifiedMemoryUsedGiB: toNum(o.unifiedMemoryUsedGiB ?? o.unified_memory_used_gib),
      unifiedMemoryTotalGiB: toNum(o.unifiedMemoryTotalGiB ?? o.unified_memory_total_gib),
      freeMemoryGiB: toNum(o.freeMemoryGiB ?? o.free_memory_gib),
      systemMemoryAvailableGiB: toNum(o.systemMemoryAvailableGiB ?? o.system_memory_available_gib),
      startupFreeMemoryGiB: toNum(o.startupFreeMemoryGiB ?? o.startup_free_memory_gib),
      memoryMetricSource: toStr(o.memoryMetricSource ?? o.memory_metric_source),
      gpuProcessCount: toNum(o.gpuProcessCount ?? o.gpu_process_count),
      gpuProcessMemoryUsedGiB: toNum(o.gpuProcessMemoryUsedGiB ?? o.gpu_process_memory_used_gib),
      gpuProcesses: toGpuProcesses(o.gpuProcesses ?? o.gpu_processes),
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
