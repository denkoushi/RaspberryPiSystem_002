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
  metrics?: MetricsPayload
): DgxBusinessModelProfile['startupFit'] {
  if (profile.runtimeProfile?.engine && profile.runtimeProfile.engine !== 'vllm') {
    return {
      status: 'not_applicable',
      detailJa: 'vLLM以外',
    };
  }

  const requiredGiB = estimateRequiredGiB(profile, metrics);
  const availableGiB = startupAvailableGiB(metrics);
  if (requiredGiB == null || availableGiB == null) {
    return {
      status: 'unknown',
      ...(requiredGiB != null ? { requiredGiB: roundGiB(requiredGiB) } : {}),
      ...(availableGiB != null ? { availableGiB: roundGiB(availableGiB) } : {}),
      detailJa: '起動判定未取得',
    };
  }

  const roundedRequired = roundGiB(requiredGiB);
  const roundedAvailable = roundGiB(availableGiB);
  if (availableGiB >= requiredGiB) {
    return {
      status: 'fits',
      requiredGiB: roundedRequired,
      availableGiB: roundedAvailable,
      detailJa: `起動可 ${roundedAvailable} / ${roundedRequired} GiB`,
    };
  }
  return {
    status: 'insufficient',
    requiredGiB: roundedRequired,
    availableGiB: roundedAvailable,
    detailJa: `メモリ不足 ${roundedAvailable} / ${roundedRequired} GiB`,
  };
}

export function enrichDgxModelProfilesStartupFit(
  modelProfiles: DgxModelProfilesOverview,
  metrics?: MetricsPayload
): DgxModelProfilesOverview {
  const available = modelProfiles.available.map((profile) => ({
    ...profile,
    startupFit: buildDgxModelStartupFit(profile, metrics),
  }));
  const selectableIds = new Set(modelProfiles.businessReturnSelectable.map((profile) => profile.id));
  return {
    ...modelProfiles,
    available,
    businessReturnSelectable: available.filter((profile) => selectableIds.has(profile.id)),
  };
}
