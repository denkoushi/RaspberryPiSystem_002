import type { MetricsPayload } from './dgx-resource.probes.js';
import type { DgxBusinessModelProfile, DgxModelProfilesOverview } from './dgx-resource.model-profiles.js';

function roundGiB(value: number): number {
  return Math.round(value * 10) / 10;
}

function startupAvailableGiB(metrics?: MetricsPayload): number | undefined {
  return metrics?.startupFreeMemoryGiB ?? metrics?.systemMemoryAvailableGiB ?? metrics?.freeMemoryGiB;
}

function estimateRequiredGiB(profile: DgxBusinessModelProfile, metrics?: MetricsPayload): number | undefined {
  const utilization = profile.runtimeProfile?.vllm?.gpuMemoryUtilization;
  const total = metrics?.unifiedMemoryTotalGiB;
  if (utilization != null && utilization > 0 && total != null && total > 0) {
    return total * utilization;
  }
  return undefined;
}

export function buildDgxModelStartupFit(
  profile: DgxBusinessModelProfile,
  metrics?: MetricsPayload,
  activeProfile?: DgxBusinessModelProfile,
  activeProfileId?: string | null
): DgxBusinessModelProfile['startupFit'] {
  const requiredGiB = estimateRequiredGiB(profile, metrics);
  const freeGiB = startupAvailableGiB(metrics);
  const reclaimedGiB = activeProfileId
    ? metrics?.gpuProcessMemoryUsedGiB ?? (activeProfile ? estimateRequiredGiB(activeProfile, metrics) : undefined)
    : 0;
  const availableGiB = freeGiB != null && reclaimedGiB != null ? freeGiB + reclaimedGiB : undefined;
  const amounts = {
    ...(requiredGiB != null ? { requiredGiB } : {}),
    ...(availableGiB != null ? { availableGiB } : {}),
  };
  if (profile.id === activeProfileId) return { status: 'fits', ...amounts, detailJa: '稼働中' };
  if (profile.runtimeProfile?.engine && profile.runtimeProfile.engine !== 'vllm') {
    return {
      status: 'not_applicable', ...amounts,
      detailJa: 'vLLM以外',
    };
  }

  if (requiredGiB == null || availableGiB == null) {
    return {
      status: 'unknown',
      ...amounts,
      detailJa: '起動判定未取得',
    };
  }

  const roundedRequired = roundGiB(requiredGiB);
  const roundedAvailable = roundGiB(availableGiB);
  if (availableGiB >= requiredGiB) {
    return {
      status: 'fits',
      requiredGiB,
      availableGiB,
      detailJa: `起動可 ${roundedAvailable} / ${roundedRequired} GiB`,
    };
  }
  return {
    status: 'insufficient',
    requiredGiB,
    availableGiB,
    detailJa: `メモリ不足 ${roundedAvailable} / ${roundedRequired} GiB`,
  };
}

export function enrichDgxModelProfilesStartupFit(
  modelProfiles: DgxModelProfilesOverview,
  metrics?: MetricsPayload
): DgxModelProfilesOverview {
  const active = modelProfiles.available.find((profile) => profile.id === modelProfiles.activeProfileId);
  const available = modelProfiles.available.map((profile) => ({
    ...profile,
    startupFit: buildDgxModelStartupFit(profile, metrics, active, modelProfiles.activeProfileId),
  }));
  const selectableIds = new Set(modelProfiles.businessReturnSelectable.map((profile) => profile.id));
  return {
    ...modelProfiles,
    available,
    businessReturnSelectable: available.filter((profile) => selectableIds.has(profile.id)),
  };
}
