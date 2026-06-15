import { describe, expect, it } from 'vitest';

import { buildDgxResourcePreflightItems } from './dgxResourcePreflightModel';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

function overview(partial?: Partial<DgxResourceOverview>): DgxResourceOverview {
  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      gpuUtilPct: 44,
      gpuTemperatureC: 46,
      gpuPowerDrawW: 11,
      gpuPowerLimitW: 120,
      gpuClockSmMhz: 1280,
      gpuClockGraphicsMhz: 1280,
      gpuClockMemoryMhz: 850,
      gpuPstate: 'P2',
      gpuClocksThrottleReason: 'none',
      gpuName: 'NVIDIA GB10',
      driverVersion: '580.159.03',
      unifiedMemoryUsedGiB: 32,
      unifiedMemoryTotalGiB: 128,
      freeMemoryGiB: 96,
      policyMode: 'business_first',
      policyLabel: '業務優先',
    },
    policy: {
      mode: 'business_first',
      previousMode: null,
      comfyStartBlockedHint: false,
    },
    runtime: {
      localLlmMode: 'on_demand',
      runtimeControlConfigured: true,
      warmWindow: { enabled: false },
    },
    optionalProbes: {
      metricsConfigured: true,
      comfyHealthConfigured: false,
      embeddingHealthConfigured: false,
      sparkHostConfigured: true,
      comfyRuntimeControlConfigured: false,
      experimentLabHealthConfigured: false,
      experimentLabRuntimeControlConfigured: false,
      agentContainerHealthConfigured: false,
      agentContainerRuntimeControlConfigured: false,
    },
    targets: [
      {
        id: 'system-prod-inference',
        kind: 'http_probe',
        displayName: 'inference-backend (/v1/models)',
        capabilities: ['readStatus'],
        status: 'running',
        badges: [],
        metaLines: ['/v1/models -> 200'],
      },
    ],
    sparkHost: { configured: true, probedAt: new Date().toISOString(), status: 'running' },
    services: [],
    notes: [],
    monitoring: {
      activeInferenceSummary: null,
      sparkSummaryJa: 'ok',
      alerts: [],
      targetHighlights: [],
      lastScenarioFailure: null,
    },
    runtimeSummary: {
      activeProfileId: 'business_qwen36_27b_nvfp4',
      activeProfileDisplayNameJa: 'Qwen3.6 27B NVFP4',
      activeBackend: 'blue',
      businessReady: true,
      businessReadyDetailJa: 'ready',
      policyMode: 'business_first',
      policyLabel: '業務優先',
      runtimeSource: 'model_profile_state',
      inferenceDegraded: false,
      resourceOwner: 'business',
      resourceOwnerLabelJa: '業務',
      resourceStateStatus: 'ready',
      resourceStateDetailJa: 'ready',
    },
    ...partial,
  };
}

describe('buildDgxResourcePreflightItems', () => {
  it('温度・電力・クロック・統合メモリ・active model・vLLM疎通を6項目で判定する', () => {
    const items = buildDgxResourcePreflightItems(overview());

    expect(items.map((item) => item.key)).toEqual([
      'temperature',
      'power',
      'clock',
      'unified-memory',
      'active-model',
      'vllm',
    ]);
    expect(items.map((item) => item.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(items.find((item) => item.key === 'power')?.value).toBe('11 / 120 W');
    expect(items.find((item) => item.key === 'clock')?.value).toBe('1280 MHz');
    expect(items.find((item) => item.key === 'active-model')?.value).toBe('Qwen3.6 27B NVFP4');
    expect(items.find((item) => item.key === 'vllm')?.value).toBe('疎通OK');
  });

  it('高負荷・低クロック・停止を注意・要確認に落とす', () => {
    const base = overview();
    const items = buildDgxResourcePreflightItems(
      overview({
        ...base,
        kpis: {
          ...base.kpis,
          gpuUtilPct: 74,
          gpuTemperatureC: 86,
          gpuPowerDrawW: 116,
          gpuPowerLimitW: 120,
          gpuClockSmMhz: 420,
          gpuPstate: 'P8',
          unifiedMemoryUsedGiB: 118,
          unifiedMemoryTotalGiB: 128,
          freeMemoryGiB: 10,
        },
        runtimeSummary: {
          ...base.runtimeSummary!,
          businessReady: false,
        },
        targets: [
          {
            id: 'system-prod-inference',
            kind: 'http_probe',
            displayName: 'inference-backend (/v1/models)',
            capabilities: ['readStatus'],
            status: 'stopped',
            badges: [],
            metaLines: ['/v1/models -> 503'],
          },
        ],
      })
    );

    expect(items.find((item) => item.key === 'temperature')?.status).toBe('bad');
    expect(items.find((item) => item.key === 'power')?.status).toBe('bad');
    expect(items.find((item) => item.key === 'clock')?.status).toBe('bad');
    expect(items.find((item) => item.key === 'unified-memory')?.status).toBe('bad');
    expect(items.find((item) => item.key === 'active-model')?.status).toBe('warn');
    expect(items.find((item) => item.key === 'vllm')?.status).toBe('bad');
  });

  it('低負荷時の低クロックは正常として扱う', () => {
    const base = overview();
    const items = buildDgxResourcePreflightItems(
      overview({
        ...base,
        kpis: {
          ...base.kpis,
          gpuUtilPct: 0,
          gpuClockSmMhz: 300,
          gpuPstate: 'P8',
        },
      })
    );

    expect(items.find((item) => item.key === 'clock')?.status).toBe('ok');
    expect(items.find((item) => item.key === 'clock')?.detail).toContain('低負荷時');
  });
});
