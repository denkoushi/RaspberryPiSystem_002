/**
 * Production schedule query facade.
 * Implementation lives under ./production-schedule-query/; this file preserves the public export surface.
 */

export { normalizeMachineNameForCompare } from './machine-name-compare.js';

export {
  prepareProductionScheduleDashboardFilters,
} from './production-schedule-query/filters.js';
export {
  listLeaderboardShellProductionScheduleRows,
  listLeaderboardShellContinuationProductionScheduleRows,
  countProductionScheduleDashboardVisibleRowsFromListFilters,
} from './production-schedule-query/leaderboard-shell.js';
export {
  decorateLeaderboardShellRowsForKioskFromHydratedRows,
  decorateLeaderboardShellRowsForKiosk,
} from './production-schedule-query/leaderboard-decoration.js';
export {
  listSelfInspectionEligibleProductionScheduleRows,
} from './production-schedule-query/self-inspection-eligible.js';
export {
  scanProductionScheduleRowsForSignageMachineBoard,
  listProductionScheduleRowsForSignageMachineBoard,
} from './production-schedule-query/signage-machine-board.js';
export {
  scanProductionScheduleRowsForSignageAutoTargetSelector,
  decorateRowsForSelfInspectionMachineTargetSelector,
} from './production-schedule-query/signage-auto-target.js';
export {
  listProductionScheduleRows,
} from './production-schedule-query/list.js';
export {
  searchProductionScheduleOrders,
} from './production-schedule-query/order-search.js';
export {
  listProductionScheduleResources,
} from './production-schedule-query/resources.js';
export {
  getProductionScheduleOrderUsage,
} from './production-schedule-query/order-usage.js';

export type {
  ProductionScheduleSelfInspectionStatus,
  ProductionScheduleRow,
  ProductionScheduleListParams,
  ProductionScheduleListResult,
} from './production-schedule-query/types.js';
export type {
  LeaderboardShellPhasedReadResult,
} from './production-schedule-query/leaderboard-shell.js';
export type {
  PreparedProductionScheduleDashboardFilters,
} from './production-schedule-query/filters.js';
export type {
  ProductionScheduleLeaderboardDecorationPayload,
} from './production-schedule-query/leaderboard-decoration.js';
export type {
  ProductionScheduleOrderUsageParams,
} from './production-schedule-query/order-usage.js';
export type {
  SignageMachineBoardScheduleRow,
  SignageMachineBoardScheduleFetchResult,
  SignageMachineBoardScheduleScanMeta,
} from './production-schedule-query/signage-machine-board.js';
export type {
  SignageAutoTargetSelectorScheduleRow,
  SignageAutoTargetSelectorScanMeta,
  SelfInspectionMachineTargetSelectorRowDecoration,
} from './production-schedule-query/signage-auto-target.js';
export type {
  ProductionScheduleOrderSearchParams,
  ProductionScheduleOrderSearchResult,
} from './production-schedule-query/order-search.js';
export type {
  ProductionScheduleResourceListResult,
} from './production-schedule-query/resources.js';
