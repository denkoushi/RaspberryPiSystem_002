import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { assembleStartDateLevelingResult } from './start-date-leveling-assembler.js';
import { listStartDateLevelingQueryRows } from './start-date-leveling-query.service.js';
import { fetchLoadBalancingWinnerRowIds } from './load-balancing-winner-row-ids.js';
import type { StartDateLevelingMoveInput, StartDateLevelingResult } from './start-date-leveling.types.js';
import { parseYearMonthRangeInclusive } from './year-month-range.js';

async function fetchLevelingRows(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  resourceCdFilter?: string | null;
}) {
  const range = parseYearMonthRangeInclusive({
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    maxMonths: 12
  });
  const siteKey = resolveSiteKeyFromScopeKey(params.siteKeyInput.trim());
  const winnerRowIds = await fetchLoadBalancingWinnerRowIds();
  const queryRows = await listStartDateLevelingQueryRows({
    siteKey,
    deviceScopeKey: params.deviceScopeKey,
    rangeStart: range.rangeStart,
    rangeEndExclusive: range.rangeEndExclusive,
    resourceCdFilter: params.resourceCdFilter,
    winnerRowIds
  });
  return { siteKey, queryRows };
}

export async function getProductionScheduleStartDateLeveling(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  bucket: 'month' | 'day';
  focusMonth?: string | null;
  resourceCdFilter?: string | null;
}): Promise<StartDateLevelingResult> {
  const { siteKey, queryRows } = await fetchLevelingRows(params);
  return assembleStartDateLevelingResult({
    siteKeyInput: siteKey,
    deviceScopeKey: params.deviceScopeKey,
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    bucket: params.bucket,
    focusMonth: params.focusMonth,
    resourceCdFilter: params.resourceCdFilter,
    queryRows
  });
}

export async function simulateProductionScheduleStartDateLeveling(params: {
  siteKeyInput: string;
  deviceScopeKey: string;
  fromMonth: string;
  toMonth: string;
  bucket: 'month' | 'day';
  focusMonth?: string | null;
  resourceCdFilter?: string | null;
  moves: StartDateLevelingMoveInput[];
}): Promise<StartDateLevelingResult> {
  const { siteKey, queryRows } = await fetchLevelingRows(params);
  return assembleStartDateLevelingResult({
    siteKeyInput: siteKey,
    deviceScopeKey: params.deviceScopeKey,
    fromMonth: params.fromMonth,
    toMonth: params.toMonth,
    bucket: params.bucket,
    focusMonth: params.focusMonth,
    resourceCdFilter: params.resourceCdFilter,
    queryRows,
    moves: params.moves
  });
}
