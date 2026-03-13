import { env } from '../../config/env.js';
import { GLOBAL_SHARED_LOCATION_KEY } from './due-management-ranking-scope-policy.service.js';

type FeatureLikeRow = {
  fhincd: string;
  resourceCd: string;
  location: string;
};

const normalizeKeyPart = (value: string): string => value.trim().toUpperCase();

export const isActualHoursSharedFallbackEnabled = (): boolean =>
  env.ACTUAL_HOURS_SHARED_FALLBACK_ENABLED === 'true';

export const resolveActualHoursLocationCandidates = (actorLocation: string): string[] => {
  const normalizedActorLocation = actorLocation.trim();
  if (!normalizedActorLocation) {
    return [GLOBAL_SHARED_LOCATION_KEY];
  }

  if (!isActualHoursSharedFallbackEnabled() || normalizedActorLocation === GLOBAL_SHARED_LOCATION_KEY) {
    return [normalizedActorLocation];
  }

  return [normalizedActorLocation, GLOBAL_SHARED_LOCATION_KEY];
};

export function pickActualHoursRowsByLocationPriority<T extends FeatureLikeRow>(
  rows: T[],
  locationCandidates: string[]
): T[] {
  if (rows.length === 0 || locationCandidates.length === 0) {
    return [];
  }

  const priorityByLocation = new Map(
    locationCandidates.map((location, index) => [location.trim(), index] as const).filter(([location]) => location.length > 0)
  );
  const selected = new Map<string, T>();
  for (const row of rows) {
    const location = row.location?.trim() ?? '';
    if (!priorityByLocation.has(location)) {
      continue;
    }
    const fhincd = normalizeKeyPart(row.fhincd);
    const resourceCd = normalizeKeyPart(row.resourceCd);
    if (!fhincd || !resourceCd) {
      continue;
    }

    const key = `${fhincd}__${resourceCd}`;
    const current = selected.get(key);
    if (!current) {
      selected.set(key, row);
      continue;
    }

    const nextPriority = priorityByLocation.get(location) ?? Number.MAX_SAFE_INTEGER;
    const currentPriority = priorityByLocation.get(current.location.trim()) ?? Number.MAX_SAFE_INTEGER;
    if (nextPriority < currentPriority) {
      selected.set(key, row);
    }
  }
  return Array.from(selected.values());
}
