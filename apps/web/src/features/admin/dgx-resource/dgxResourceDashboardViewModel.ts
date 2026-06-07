import { formatUnifiedMemDisplay } from './dgxResourceKpiStripModel';

import type {
  DgxControlTargetIdApi,
  DgxResourceOverview,
  DgxResourceRuntimeSummaryApi,
  DgxServiceStatusKind,
} from '../../../api/dgx-resource.types';

export type DgxResourceStatusTone = 'good' | 'loading' | 'warn' | 'danger' | 'muted' | 'info';

export type DgxResourceStatusHeaderItem = {
  key: string;
  label: string;
  value: string;
  tone: DgxResourceStatusTone;
  hint?: string;
};

export type DgxResourceServicePill = {
  key: DgxControlTargetIdApi;
  label: string;
  value: string;
  tone: DgxResourceStatusTone;
  hint?: string;
};

export type DgxResourceDetailRow = {
  key: string;
  label: string;
  value: string;
  hint?: string;
};

export type DgxResourceDashboardViewModel = {
  headerItems: DgxResourceStatusHeaderItem[];
  services: DgxResourceServicePill[];
  detailRows: DgxResourceDetailRow[];
};

function serviceTone(status: DgxServiceStatusKind): DgxResourceStatusTone {
  if (status === 'running') return 'good';
  if (status === 'degraded') return 'warn';
  if (status === 'stopped') return 'muted';
  return 'muted';
}

function targetStatus(overview: DgxResourceOverview, id: DgxControlTargetIdApi): DgxServiceStatusKind {
  return overview.targets?.find((target) => target.id === id)?.status ?? 'unknown';
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case 'running':
      return '稼働';
    case 'ready':
      return '準備完了';
    case 'preparing':
      return '準備中';
    case 'degraded':
      return '低下';
    case 'stopped':
      return '停止';
    case 'unknown':
    case null:
    case undefined:
      return '不明';
    default:
      return status;
  }
}

function readyTone(input: {
  ready: boolean;
  loading: boolean;
  degraded: boolean;
}): DgxResourceStatusTone {
  if (input.ready) return 'good';
  if (input.loading) return 'loading';
  if (input.degraded) return 'warn';
  return 'muted';
}

export function buildDgxResourceDashboardViewModel(
  overview: DgxResourceOverview,
  options?: { scenarioPending?: boolean }
): DgxResourceDashboardViewModel {
  const summary: DgxResourceRuntimeSummaryApi = overview.runtimeSummary ?? {
    activeProfileId: null,
    activeProfileDisplayNameJa: null,
    activeBackend: null,
    businessReady: false,
    businessReadyDetailJa: '未取得',
    policyMode: overview.policy.mode,
    policyLabel: overview.kpis.policyLabel,
    runtimeSource: 'unknown',
    inferenceDegraded: false,
    resourceOwner: 'unknown',
    resourceOwnerLabelJa: '不明',
    resourceStateStatus: 'unknown',
    resourceStateDetailJa: undefined,
  };
  const loading =
    Boolean(options?.scenarioPending) ||
    (summary.resourceOwner === 'business' &&
      summary.resourceStateStatus === 'preparing' &&
      summary.businessReady === false);
  const activeModel =
    summary.activeProfileDisplayNameJa ??
    summary.activeProfileId ??
    '未ロード';
  const unifiedMemory = formatUnifiedMemDisplay(
    overview.kpis.unifiedMemoryUsedGiB,
    overview.kpis.unifiedMemoryTotalGiB
  );
  const readyValue = summary.businessReady ? '準備完了' : loading ? 'ロード中' : summary.inferenceDegraded ? '低下' : '未準備';
  const businessStatus = targetStatus(overview, 'system-prod-inference');
  const comfyStatus = targetStatus(overview, 'private-comfyui');
  const experimentStatus = targetStatus(overview, 'experiment-lab');

  const services: DgxResourceServicePill[] = [
    {
      key: 'system-prod-inference',
      label: 'VLM',
      value: statusLabel(businessStatus),
      tone: serviceTone(businessStatus),
      hint: businessStatus,
    },
    {
      key: 'private-comfyui',
      label: 'ComfyUI',
      value: statusLabel(comfyStatus),
      tone: serviceTone(comfyStatus),
      hint: comfyStatus,
    },
    {
      key: 'experiment-lab',
      label: '実験',
      value: statusLabel(experimentStatus),
      tone: serviceTone(experimentStatus),
      hint: experimentStatus,
    },
  ];

  return {
    headerItems: [
      {
        key: 'owner',
        label: 'DGX',
        value: summary.resourceOwnerLabelJa ?? '不明',
        tone: summary.resourceOwner === 'business' ? 'good' : summary.resourceOwner === 'unknown' ? 'muted' : 'info',
        hint: summary.resourceStateDetailJa,
      },
      {
        key: 'ready',
        label: '業務推論',
        value: readyValue,
        tone: readyTone({
          ready: summary.businessReady,
          loading,
          degraded: summary.inferenceDegraded,
        }),
        hint: summary.businessReadyDetailJa,
      },
      {
        key: 'model',
        label: 'モデル',
        value: activeModel,
        tone: summary.activeProfileId ? 'info' : 'muted',
      },
      {
        key: 'memory',
        label: 'メモリ',
        value: unifiedMemory,
        tone: overview.kpis.freeMemoryGiB != null && overview.kpis.freeMemoryGiB < 12 ? 'warn' : 'muted',
      },
    ],
    services,
    detailRows: [
      {
        key: 'backend',
        label: 'バックエンド',
        value: summary.activeBackend ?? '不明',
      },
      {
        key: 'policy',
        label: 'ポリシー',
        value: summary.policyLabel,
      },
      {
        key: 'resource-state',
        label: 'リソース状態',
        value: statusLabel(summary.resourceStateStatus),
        hint: summary.resourceStateDetailJa,
      },
      {
        key: 'gpu',
        label: 'GPU',
        value: overview.kpis.gpuUtilPct == null ? '未取得' : `${Math.round(overview.kpis.gpuUtilPct)}%`,
      },
      {
        key: 'free-memory',
        label: '空きメモリ',
        value: overview.kpis.freeMemoryGiB == null ? '未取得' : `${overview.kpis.freeMemoryGiB} GiB`,
      },
    ],
  };
}
