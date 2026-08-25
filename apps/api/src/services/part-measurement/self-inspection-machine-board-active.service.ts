import { getResourceNameMapByResourceCds } from '../production-schedule/resource-master.service.js';
import {
  resolveSeibanMachineDisplayNamesBatched,
} from '../production-schedule/seiban-machine-display-names.service.js';
import { isMissingSeibanMachineName } from '../production-schedule/seiban-machine-name-state.js';
import {
  aggregateSelfInspectionMachineBoardCards,
} from './self-inspection-machine-board-aggregation.js';
import {
  SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT,
  fetchSelfInspectionMachineBoardActiveSessions,
} from './self-inspection-machine-board-active.repository.js';
import {
  mapSelfInspectionMachineBoardActiveSessionsToAggregationRows,
} from './self-inspection-machine-board-active.js';
import type { SelfInspectionMachineBoardViewModel } from './self-inspection-machine-board.types.js';
import {
  buildFlatMachineBoardPages,
  sanitizeSelfInspectionMachineBoardPartsPerPage,
} from '../signage/self-inspection-machine-board/pagination.js';

const KIOSK_ACTIVE_SESSIONS_BOARD_LABEL = 'キオスク自主検査';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * キオスク自主検査画面に表示される active session を部品カード VM へ変換する。
 * kiosk_active_sessions はキオスクの active session 全体を正本とする。旧 mode の
 * machineName/deviceScopeKey/resourceCds/maxAutoMachines はこの経路へ渡さない。
 */
export async function buildKioskActiveSelfInspectionMachineBoardViewModel(options: {
  partsPerPage?: number;
  /** 新 VM では詳細ページを生成しない。旧呼び出し元互換のため受け付ける。 */
  detailTopN?: number;
}): Promise<SelfInspectionMachineBoardViewModel> {
  const partsPerPage = sanitizeSelfInspectionMachineBoardPartsPerPage(
    options.partsPerPage ?? Number.NaN
  );
  const activeSessions = await fetchSelfInspectionMachineBoardActiveSessions({
    limit: SELF_INSPECTION_MACHINE_BOARD_ACTIVE_SESSION_LIMIT,
  });
  const updatedAt = activeSessions.sessions[0]?.updatedAt ?? new Date();

  if (activeSessions.sessions.length === 0) {
    return {
      machineName: KIOSK_ACTIVE_SESSIONS_BOARD_LABEL,
      normalizedMachineName: '',
      updatedAt,
      pages: [],
      totalPages: 0,
      scheduleRowCap: activeSessions.limit,
      scheduleRowHasMore: activeSessions.hasMore,
      loadedScheduleRowCount: 0,
      activeSessionLimit: activeSessions.limit,
      activeSessionHasMore: activeSessions.hasMore,
      activeSessionCount: 0,
    };
  }

  const missingFseibans = activeSessions.sessions
    .filter((session) => isMissingSeibanMachineName(session.machineName))
    .map((session) => normalizeText(session.fseiban))
    .filter((fseiban) => fseiban.length > 0);
  const resourceCds = activeSessions.sessions.map((session) => session.resourceCd);
  const [{ machineNames }, resourceNameMap] = await Promise.all([
    resolveSeibanMachineDisplayNamesBatched(missingFseibans),
    getResourceNameMapByResourceCds(resourceCds),
  ]);
  const rows = mapSelfInspectionMachineBoardActiveSessionsToAggregationRows(
    activeSessions.sessions,
    {
      machineNameByFseiban: machineNames,
      resourceNameMap,
    }
  );
  const cards = aggregateSelfInspectionMachineBoardCards(rows);
  const pages = buildFlatMachineBoardPages({
    machineName: KIOSK_ACTIVE_SESSIONS_BOARD_LABEL,
    updatedAt,
    orderedParts: cards,
    detailPages: [],
    partsPerPage,
    scheduleRowCap: activeSessions.limit,
    scheduleRowHasMore: activeSessions.hasMore,
  }).map((page) =>
    page.kind === 'summary'
      ? {
          ...page,
          activeSessionLimit: activeSessions.limit,
          activeSessionHasMore: activeSessions.hasMore,
        }
      : page
  );

  void options.detailTopN;

  return {
    machineName: KIOSK_ACTIVE_SESSIONS_BOARD_LABEL,
    normalizedMachineName: '',
    updatedAt,
    pages,
    totalPages: pages.length,
    scheduleRowCap: activeSessions.limit,
    scheduleRowHasMore: activeSessions.hasMore,
    loadedScheduleRowCount: activeSessions.sessions.length,
    activeSessionLimit: activeSessions.limit,
    activeSessionHasMore: activeSessions.hasMore,
    activeSessionCount: activeSessions.sessions.length,
  };
}

export const buildSelfInspectionMachineBoardFromKioskActiveSessions =
  buildKioskActiveSelfInspectionMachineBoardViewModel;
