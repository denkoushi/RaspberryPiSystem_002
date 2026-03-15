import { env } from '../../config/env.js';
import { DEFAULT_LOCATION_SCOPE_KEY, resolveSiteKeyFromScopeKey } from '../../lib/location-scope-resolver.js';
import {
  getDueManagementSeibanDetail,
  listDueManagementSummaries,
  type DueManagementSeibanDetail,
  type DueManagementSummaryItem
} from './due-management-query.service.js';

export type DueManagementLocationScopeInput =
  | string
  | {
      deviceScopeKey?: string;
      siteKey?: string;
      legacyLocationKey?: string;
    };

export type ResolvedDueManagementLocationScope = {
  deviceScopeKey: string;
  siteKey: string;
  legacyLocationKey: string;
};

const normalizeScopeToken = (value: string | null | undefined): string => value?.trim() ?? '';

export const resolveDueManagementLocationScope = (
  scope: DueManagementLocationScopeInput
): ResolvedDueManagementLocationScope => {
  if (typeof scope === 'string') {
    const normalized = normalizeScopeToken(scope) || DEFAULT_LOCATION_SCOPE_KEY;
    return {
      deviceScopeKey: normalized,
      siteKey: resolveSiteKeyFromScopeKey(normalized),
      legacyLocationKey: normalized
    };
  }
  const deviceScopeKey = normalizeScopeToken(scope.deviceScopeKey);
  const legacyLocationKey = normalizeScopeToken(scope.legacyLocationKey);
  const fallbackScopeKey = deviceScopeKey || legacyLocationKey || DEFAULT_LOCATION_SCOPE_KEY;
  const siteKey = normalizeScopeToken(scope.siteKey) || resolveSiteKeyFromScopeKey(fallbackScopeKey);
  return {
    deviceScopeKey: deviceScopeKey || fallbackScopeKey,
    siteKey,
    legacyLocationKey: legacyLocationKey || fallbackScopeKey
  };
};

export const isLocationScopePhase3Enabled = (): boolean => env.LOCATION_SCOPE_PHASE3_ENABLED === 'true';

export const resolveDueManagementStorageLocationKey = (scope: ResolvedDueManagementLocationScope): string =>
  isLocationScopePhase3Enabled() ? scope.deviceScopeKey : scope.legacyLocationKey;

export async function listDueManagementSummariesWithScope(
  locationScope: DueManagementLocationScopeInput
): Promise<DueManagementSummaryItem[]> {
  const scope = resolveDueManagementLocationScope(locationScope);
  return listDueManagementSummaries(resolveDueManagementStorageLocationKey(scope));
}

export async function getDueManagementSeibanDetailWithScope(params: {
  fseiban: string;
  locationScope: DueManagementLocationScopeInput;
}): Promise<DueManagementSeibanDetail> {
  const scope = resolveDueManagementLocationScope(params.locationScope);
  return getDueManagementSeibanDetail({
    fseiban: params.fseiban,
    locationKey: resolveDueManagementStorageLocationKey(scope)
  });
}
