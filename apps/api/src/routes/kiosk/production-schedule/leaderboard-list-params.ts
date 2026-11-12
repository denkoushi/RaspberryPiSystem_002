import type { z } from 'zod';

import type { LocationScopeContext } from '../shared.js';
import {
  parseCsvList,
  toLegacyLocationKeyFromDeviceScope,
  type productionScheduleLeaderboardShellContinuationFieldsSchema
} from './shared.js';
import { resolveProductionScheduleAssignmentLocationKey } from './resolve-assignment-location-key.js';

type LeaderboardListFields = Pick<z.infer<typeof productionScheduleLeaderboardShellContinuationFieldsSchema>,
  | 'q' | 'productNo' | 'productNos' | 'machineName' | 'resourceCds' | 'resourceAssignedOnlyCds'
  | 'resourceCategory' | 'hasNoteOnly' | 'hasDueDateOnly' | 'allowResourceOnly'
  | 'completionFilter' | 'dueSource' | 'targetDeviceScopeKey'
>;

type LeaderboardLocationScope = Pick<LocationScopeContext, 'deviceScopeKey' | 'canProxyOtherDevices' | 'siteKey'>;

/** 資源ボード用: 資源 CD は boardResourceCds で別に渡すので、一覧の resourceCds は含めない。 */
export async function parseLeaderboardBoardListParamsBase(
  fields: LeaderboardListFields,
  locationScopeContext: LeaderboardLocationScope
) {
  const queryText = (fields.q ?? fields.productNo)?.trim() ?? '';
  const productNos = parseCsvList(fields.productNos);
  const machineName = fields.machineName?.trim();
  const assignedOnlyCds = parseCsvList(fields.resourceAssignedOnlyCds);
  const locationKey = await resolveProductionScheduleAssignmentLocationKey({
    actorDeviceScopeKey: toLegacyLocationKeyFromDeviceScope(locationScopeContext.deviceScopeKey),
    actorCanProxyOtherDevices: locationScopeContext.canProxyOtherDevices,
    targetDeviceScopeKey: fields.targetDeviceScopeKey
  });

  return {
    queryText,
    productNos,
    machineName: machineName && machineName.length > 0 ? machineName : undefined,
    assignedOnlyCds,
    resourceCategory: fields.resourceCategory,
    hasNoteOnly: fields.hasNoteOnly === true,
    hasDueDateOnly: fields.hasDueDateOnly === true,
    allowResourceOnly: fields.allowResourceOnly === true,
    completionFilter: fields.completionFilter,
    dueSource: fields.dueSource,
    locationKey,
    siteKey: locationScopeContext.siteKey
  };
}

export async function parseLeaderboardListParams(
  fields: LeaderboardListFields,
  locationScopeContext: LeaderboardLocationScope
) {
  const base = await parseLeaderboardBoardListParamsBase(fields, locationScopeContext);
  return { ...base, resourceCds: parseCsvList(fields.resourceCds) };
}
