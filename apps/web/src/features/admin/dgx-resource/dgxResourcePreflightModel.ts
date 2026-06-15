import { formatUnifiedMemDisplay } from './dgxResourceKpiStripModel';

import type {
  DgxControlTargetSnapshotApi,
  DgxResourceOverview,
  DgxServiceStatusKind,
} from '../../../api/dgx-resource.types';

export type DgxResourcePreflightStatus = 'ok' | 'warn' | 'bad' | 'unknown';

export type DgxResourcePreflightItem = {
  key: 'temperature' | 'power' | 'clock' | 'unified-memory' | 'active-model' | 'vllm';
  label: string;
  value: string;
  status: DgxResourcePreflightStatus;
  detail: string;
};

function rounded(value: number): string {
  return String(Math.round(value));
}

function targetById(
  targets: DgxControlTargetSnapshotApi[] | undefined,
  id: DgxControlTargetSnapshotApi['id']
): DgxControlTargetSnapshotApi | undefined {
  return targets?.find((target) => target.id === id);
}

function statusJa(status: DgxServiceStatusKind | undefined): string {
  switch (status) {
    case 'running':
      return '疎通OK';
    case 'degraded':
      return '低下';
    case 'stopped':
      return '停止';
    default:
      return '不明';
  }
}

function targetStatusToPreflight(status: DgxServiceStatusKind | undefined): DgxResourcePreflightStatus {
  switch (status) {
    case 'running':
      return 'ok';
    case 'degraded':
      return 'warn';
    case 'stopped':
      return 'bad';
    default:
      return 'unknown';
  }
}

export function buildDgxResourcePreflightItems(overview: DgxResourceOverview): readonly DgxResourcePreflightItem[] {
  const kpis = overview.kpis;
  const runtime = overview.runtimeSummary;
  const inferenceTarget = targetById(overview.targets, 'system-prod-inference');
  const memoryPct =
    kpis.unifiedMemoryUsedGiB != null && kpis.unifiedMemoryTotalGiB != null && kpis.unifiedMemoryTotalGiB > 0
      ? (kpis.unifiedMemoryUsedGiB / kpis.unifiedMemoryTotalGiB) * 100
      : null;
  const powerPct =
    kpis.gpuPowerDrawW != null && kpis.gpuPowerLimitW != null && kpis.gpuPowerLimitW > 0
      ? (kpis.gpuPowerDrawW / kpis.gpuPowerLimitW) * 100
      : null;
  const activeClockMhz = kpis.gpuClockSmMhz ?? kpis.gpuClockGraphicsMhz ?? null;
  const gpuBusy = kpis.gpuUtilPct != null && kpis.gpuUtilPct >= 20;
  const activeModel = runtime?.activeProfileDisplayNameJa ?? runtime?.activeProfileId;

  return [
    {
      key: 'temperature',
      label: '温度',
      value: kpis.gpuTemperatureC == null ? '未取得' : `${rounded(kpis.gpuTemperatureC)}℃`,
      status:
        kpis.gpuTemperatureC == null
          ? 'unknown'
          : kpis.gpuTemperatureC < 72
            ? 'ok'
            : kpis.gpuTemperatureC < 82
              ? 'warn'
              : 'bad',
      detail: kpis.gpuTemperatureC == null ? 'メトリクスAPIに温度を追加すると判定できます' : 'GPU温度',
    },
    {
      key: 'power',
      label: '電力',
      value:
        kpis.gpuPowerDrawW == null
          ? '未取得'
          : kpis.gpuPowerLimitW != null && kpis.gpuPowerLimitW > 0
            ? `${rounded(kpis.gpuPowerDrawW)} / ${rounded(kpis.gpuPowerLimitW)} W`
            : `${rounded(kpis.gpuPowerDrawW)} W`,
      status:
        kpis.gpuPowerDrawW == null
          ? 'unknown'
          : powerPct == null
            ? 'ok'
            : powerPct < 80
              ? 'ok'
              : powerPct < 92
                ? 'warn'
                : 'bad',
      detail: powerPct == null ? '現在消費電力' : `電力上限比 ${rounded(powerPct)}%`,
    },
    {
      key: 'clock',
      label: 'クロック',
      value: activeClockMhz == null ? '未取得' : `${rounded(activeClockMhz)} MHz`,
      status:
        activeClockMhz == null
          ? 'unknown'
          : !gpuBusy
            ? 'ok'
            : activeClockMhz < 700
              ? 'bad'
              : activeClockMhz < 1000
                ? 'warn'
                : 'ok',
      detail:
        activeClockMhz == null
          ? 'SM/Graphicsクロックを返すと低クロックを検知できます'
          : [
              gpuBusy ? `GPU負荷 ${rounded(kpis.gpuUtilPct ?? 0)}%` : '低負荷時の低クロックは正常',
              kpis.gpuPstate ? `P-state ${kpis.gpuPstate}` : null,
              kpis.gpuClocksThrottleReason ? `Throttle ${kpis.gpuClocksThrottleReason}` : null,
            ]
              .filter((x): x is string => typeof x === 'string')
              .join(' / '),
    },
    {
      key: 'unified-memory',
      label: '統合メモリ',
      value: formatUnifiedMemDisplay(kpis.unifiedMemoryUsedGiB, kpis.unifiedMemoryTotalGiB),
      status:
        memoryPct == null
          ? 'unknown'
          : memoryPct < 72
            ? 'ok'
            : memoryPct < 85
              ? 'warn'
              : 'bad',
      detail:
        kpis.freeMemoryGiB == null
          ? '空きメモリ未取得'
          : `空き ${kpis.freeMemoryGiB} GiB`,
    },
    {
      key: 'active-model',
      label: 'active model',
      value: activeModel ?? '未ロード',
      status: activeModel == null ? 'bad' : runtime?.businessReady ? 'ok' : 'warn',
      detail: runtime?.activeBackend ? `backend ${runtime.activeBackend}` : runtime?.businessReadyDetailJa ?? '状態未取得',
    },
    {
      key: 'vllm',
      label: 'vLLM疎通',
      value: statusJa(inferenceTarget?.status),
      status: targetStatusToPreflight(inferenceTarget?.status),
      detail: inferenceTarget?.metaLines[0] ?? '/v1/models',
    },
  ];
}
