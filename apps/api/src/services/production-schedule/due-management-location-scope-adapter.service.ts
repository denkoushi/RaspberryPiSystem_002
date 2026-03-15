import { DEFAULT_LOCATION_SCOPE_KEY, resolveSiteKeyFromScopeKey } from '../../lib/location-scope-resolver.js';
import {
  getDueManagementSeibanDetail,
  listDueManagementSummaries,
  type DueManagementSeibanDetail,
  type DueManagementSummaryItem
} from './due-management-query.service.js';

export type DueManagementLocationScopeInput = {
  deviceScopeKey?: string;
  siteKey?: string;
};

export type ResolvedDueManagementLocationScope = {
  deviceScopeKey: string;
  siteKey: string;
};

export type DueManagementScope = ResolvedDueManagementLocationScope;

export type DueManagementScopeContextInput = {
  deviceScopeKey?: string;
  siteKey?: string;
};

const normalizeScopeToken = (value: string | null | undefined): string => value?.trim() ?? '';

export const resolveDueManagementLocationScope = (
  scope: DueManagementLocationScopeInput
): ResolvedDueManagementLocationScope => {
  const deviceScopeKey = normalizeScopeToken(scope.deviceScopeKey);
  const fallbackScopeKey = deviceScopeKey || DEFAULT_LOCATION_SCOPE_KEY;
  const siteKey = normalizeScopeToken(scope.siteKey) || resolveSiteKeyFromScopeKey(fallbackScopeKey);
  return {
    deviceScopeKey: deviceScopeKey || fallbackScopeKey,
    siteKey
  };
};

export const toDueManagementScope = (scope: DueManagementLocationScopeInput): DueManagementScope =>
  resolveDueManagementLocationScope(scope);

export const toDueManagementScopeFromContext = (context: DueManagementScopeContextInput): DueManagementScope =>
  resolveDueManagementLocationScope({
    deviceScopeKey: context.deviceScopeKey,
    siteKey: context.siteKey
  });

export const resolveDueManagementStorageLocationKey = (scope: DueManagementScope): string => scope.deviceScopeKey;

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
