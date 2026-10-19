import { describe, expect, it } from 'vitest';

import { productionScheduleQueryKeys } from './productionSchedule';

describe('productionScheduleQueryKeys', () => {
  it('preserves fixed keys and invalidation prefixes', () => {
    expect(productionScheduleQueryKeys.manualOrderResourceAssignmentsAll).toEqual(['kiosk-production-schedule-manual-order-resource-assignments']);
    expect(productionScheduleQueryKeys.leaderboardShellAll).toEqual(['kiosk-production-schedule', 'leaderboard-shell']);
    expect(productionScheduleQueryKeys.leaderboardTotalAll).toEqual(['kiosk-production-schedule', 'leaderboard-total']);
    expect(productionScheduleQueryKeys.leaderboardBoardAll).toEqual(['kiosk-production-schedule', 'leaderboard-board']);
    expect(productionScheduleQueryKeys.leaderboardDecorationsAll).toEqual(['kiosk-production-schedule', 'leaderboard-decorations']);
    expect(productionScheduleQueryKeys.scheduleAll).toEqual(['kiosk-production-schedule']);
    expect(productionScheduleQueryKeys.resourcesAll).toEqual(['kiosk-production-schedule-resources']);
    expect(productionScheduleQueryKeys.kioskProcessingTypeOptionsAll).toEqual(['kiosk-production-schedule-processing-type-options']);
    expect(productionScheduleQueryKeys.orderUsageAll).toEqual(['kiosk-production-schedule-order-usage']);
    expect(productionScheduleQueryKeys.searchStateAll).toEqual(['kiosk-production-schedule-search-state']);
    expect(productionScheduleQueryKeys.searchHistoryAll).toEqual(['kiosk-production-schedule-search-history']);
    expect(productionScheduleQueryKeys.historyProgressAll).toEqual(['kiosk-production-schedule-history-progress']);
    expect(productionScheduleQueryKeys.progressOverviewAll).toEqual(['kiosk-production-schedule-progress-overview']);
    expect(productionScheduleQueryKeys.dueManagementSummaryAll).toEqual(['kiosk-production-schedule-due-management-summary']);
    expect(productionScheduleQueryKeys.dueManagementTriageAll).toEqual(['kiosk-production-schedule-due-management-triage']);
    expect(productionScheduleQueryKeys.dueManagementDailyPlanAll).toEqual(['kiosk-production-schedule-due-management-daily-plan']);
    expect(productionScheduleQueryKeys.dueManagementGlobalRankAll).toEqual(['kiosk-production-schedule-due-management-global-rank']);
    expect(productionScheduleQueryKeys.dueManagementManualOrderOverviewAll).toEqual(['kiosk-production-schedule-due-management-manual-order-overview']);
    expect(productionScheduleQueryKeys.dueManagementGlobalRankProposalAll).toEqual(['kiosk-production-schedule-due-management-global-rank-proposal']);
    expect(productionScheduleQueryKeys.grindingPlanningBoardAll).toEqual(['kiosk-grinding-planning-board']);
    expect(productionScheduleQueryKeys.grindingPlanningBoardLoadAll).toEqual(['kiosk-grinding-planning-board', 'load']);
    expect(productionScheduleQueryKeys.planningBoardResourceCapacityAll).toEqual(['kiosk-planning-board-resource-capacity']);
    expect(productionScheduleQueryKeys.loadBalancingWorkspaceAll).toEqual(['kiosk-production-schedule-load-balancing-workspace']);
    expect(productionScheduleQueryKeys.loadBalancingWorkspaceDayAll).toEqual(['kiosk-production-schedule-load-balancing-workspace-day']);
    expect(productionScheduleQueryKeys.orderSplitPilotSettingsAll).toEqual(['production-schedule-order-split-pilot-settings']);
    expect(productionScheduleQueryKeys.orderSplitStatusAll).toEqual(['kiosk-production-schedule-order-split-status']);
    expect(productionScheduleQueryKeys.dueManagementSeibanDetailAll).toEqual(['kiosk-production-schedule-due-management-seiban-detail']);
  });

  it('preserves schedule values and arity', () => {
    expect(productionScheduleQueryKeys.schedule({ productNo: 'order-1', targetDeviceScopeKey: 'device-1' })).toEqual(
      ['kiosk-production-schedule', { productNo: 'order-1', targetDeviceScopeKey: 'device-1' }]
    );
    expect(productionScheduleQueryKeys.schedule()).toEqual(
      ['kiosk-production-schedule', undefined]
    );
    expect(productionScheduleQueryKeys.schedule({})).toEqual(
      ['kiosk-production-schedule', {}]
    );
  });

  it('preserves orderSearch values and arity', () => {
    expect(productionScheduleQueryKeys.orderSearch({ resourceCds: 'resource-1', productNoPrefix: 'order' })).toEqual(
      ['kiosk-production-schedule-order-search', { resourceCds: 'resource-1', productNoPrefix: 'order' }]
    );
    expect(productionScheduleQueryKeys.orderSearch()).toEqual(
      ['kiosk-production-schedule-order-search', undefined]
    );
    expect(productionScheduleQueryKeys.orderSearch({ resourceCds: '', productNoPrefix: '' })).toEqual(
      ['kiosk-production-schedule-order-search', { resourceCds: '', productNoPrefix: '' }]
    );
  });

  it('preserves orderUsage values and arity', () => {
    expect(productionScheduleQueryKeys.orderUsage('resource-1', 'device-1')).toEqual(
      ['kiosk-production-schedule-order-usage', 'resource-1', 'device-1']
    );
    expect(productionScheduleQueryKeys.orderUsage()).toEqual(
      ['kiosk-production-schedule-order-usage', undefined, undefined]
    );
    expect(productionScheduleQueryKeys.orderUsage('resource-1')).toEqual(
      ['kiosk-production-schedule-order-usage', 'resource-1', undefined]
    );
    expect(productionScheduleQueryKeys.orderUsage(undefined, 'device-1')).toEqual(
      ['kiosk-production-schedule-order-usage', undefined, 'device-1']
    );
    expect(productionScheduleQueryKeys.orderUsage('', '')).toEqual(
      ['kiosk-production-schedule-order-usage', '', '']
    );
  });

  it('preserves seibanMachineNames values and arity', () => {
    expect(productionScheduleQueryKeys.seibanMachineNames('order-1\u0001order-2')).toEqual(
      ['kiosk-production-schedule-seiban-machine-names', 'order-1\u0001order-2']
    );
    expect(productionScheduleQueryKeys.seibanMachineNames('')).toEqual(
      ['kiosk-production-schedule-seiban-machine-names', '']
    );
  });

  it('preserves dueManagementSummary values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementSummary({ resourceCd: 'resource-1', resourceCategory: 'grinding' })).toEqual(
      ['kiosk-production-schedule-due-management-summary', { resourceCd: 'resource-1', resourceCategory: 'grinding' }]
    );
    expect(productionScheduleQueryKeys.dueManagementSummary()).toEqual(
      ['kiosk-production-schedule-due-management-summary', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementSummary({})).toEqual(
      ['kiosk-production-schedule-due-management-summary', {}]
    );
  });

  it('preserves dueManagementTriage values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementTriage({ resourceCd: 'resource-1', resourceCategory: 'cutting' })).toEqual(
      ['kiosk-production-schedule-due-management-triage', { resourceCd: 'resource-1', resourceCategory: 'cutting' }]
    );
    expect(productionScheduleQueryKeys.dueManagementTriage()).toEqual(
      ['kiosk-production-schedule-due-management-triage', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementTriage({})).toEqual(
      ['kiosk-production-schedule-due-management-triage', {}]
    );
  });

  it('preserves dueManagementDailyPlan values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementDailyPlan({ resourceCd: 'resource-1' })).toEqual(
      ['kiosk-production-schedule-due-management-daily-plan', { resourceCd: 'resource-1' }]
    );
    expect(productionScheduleQueryKeys.dueManagementDailyPlan()).toEqual(
      ['kiosk-production-schedule-due-management-daily-plan', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementDailyPlan({})).toEqual(
      ['kiosk-production-schedule-due-management-daily-plan', {}]
    );
  });

  it('preserves dueManagementGlobalRank values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementGlobalRank({ targetLocation: 'location-1', rankingScope: 'globalShared', resourceCd: 'resource-1' })).toEqual(
      ['kiosk-production-schedule-due-management-global-rank', { targetLocation: 'location-1', rankingScope: 'globalShared', resourceCd: 'resource-1' }]
    );
    expect(productionScheduleQueryKeys.dueManagementGlobalRank()).toEqual(
      ['kiosk-production-schedule-due-management-global-rank', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementGlobalRank({})).toEqual(
      ['kiosk-production-schedule-due-management-global-rank', {}]
    );
  });

  it('preserves dueManagementManualOrderOverview values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementManualOrderOverview({ siteKey: 'site-1', deviceScopeKey: 'device-1', targetLocation: 'location-1', rankingScope: 'locationScoped' })).toEqual(
      ['kiosk-production-schedule-due-management-manual-order-overview', { siteKey: 'site-1', deviceScopeKey: 'device-1', targetLocation: 'location-1', rankingScope: 'locationScoped' }]
    );
    expect(productionScheduleQueryKeys.dueManagementManualOrderOverview()).toEqual(
      ['kiosk-production-schedule-due-management-manual-order-overview', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementManualOrderOverview({})).toEqual(
      ['kiosk-production-schedule-due-management-manual-order-overview', {}]
    );
  });

  it('preserves dueManagementGlobalRankProposal values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementGlobalRankProposal({ targetLocation: 'location-1', rankingScope: 'localTemporary', resourceCategory: 'cutting' })).toEqual(
      ['kiosk-production-schedule-due-management-global-rank-proposal', { targetLocation: 'location-1', rankingScope: 'localTemporary', resourceCategory: 'cutting' }]
    );
    expect(productionScheduleQueryKeys.dueManagementGlobalRankProposal()).toEqual(
      ['kiosk-production-schedule-due-management-global-rank-proposal', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementGlobalRankProposal({})).toEqual(
      ['kiosk-production-schedule-due-management-global-rank-proposal', {}]
    );
  });

  it('preserves dueManagementSeibanAll values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementSeibanAll('order-1')).toEqual(
      ['kiosk-production-schedule-due-management-seiban', 'order-1']
    );
    expect(productionScheduleQueryKeys.dueManagementSeibanAll('')).toEqual(
      ['kiosk-production-schedule-due-management-seiban', '']
    );
    expect(productionScheduleQueryKeys.dueManagementSeibanAll(null)).toEqual(
      ['kiosk-production-schedule-due-management-seiban', null]
    );
  });

  it('preserves dueManagementSeiban values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementSeiban('order-1', { resourceCd: 'resource-1', resourceCategory: 'grinding' })).toEqual(
      ['kiosk-production-schedule-due-management-seiban', 'order-1', { resourceCd: 'resource-1', resourceCategory: 'grinding' }]
    );
    expect(productionScheduleQueryKeys.dueManagementSeiban('order-1')).toEqual(
      ['kiosk-production-schedule-due-management-seiban', 'order-1', undefined]
    );
    expect(productionScheduleQueryKeys.dueManagementSeiban('', {})).toEqual(
      ['kiosk-production-schedule-due-management-seiban', '', {}]
    );
    expect(productionScheduleQueryKeys.dueManagementSeiban(null)).toEqual(
      ['kiosk-production-schedule-due-management-seiban', null, undefined]
    );
  });

  it('preserves manualOrderSiteDevices values and arity', () => {
    expect(productionScheduleQueryKeys.manualOrderSiteDevices('site-1')).toEqual(
      ['kiosk-production-schedule-manual-order-site-devices', 'site-1']
    );
    expect(productionScheduleQueryKeys.manualOrderSiteDevices()).toEqual(
      ['kiosk-production-schedule-manual-order-site-devices', undefined]
    );
    expect(productionScheduleQueryKeys.manualOrderSiteDevices('')).toEqual(
      ['kiosk-production-schedule-manual-order-site-devices', '']
    );
  });

  it('preserves manualOrderResourceAssignments values and arity', () => {
    expect(productionScheduleQueryKeys.manualOrderResourceAssignments('site-1')).toEqual(
      ['kiosk-production-schedule-manual-order-resource-assignments', 'site-1']
    );
    expect(productionScheduleQueryKeys.manualOrderResourceAssignments()).toEqual(
      ['kiosk-production-schedule-manual-order-resource-assignments', undefined]
    );
    expect(productionScheduleQueryKeys.manualOrderResourceAssignments('')).toEqual(
      ['kiosk-production-schedule-manual-order-resource-assignments', '']
    );
  });

  it('preserves grindingPlanningBoard values and arity', () => {
    expect(productionScheduleQueryKeys.grindingPlanningBoard({ category: 'grinding', view: 'resource' })).toEqual(
      ['kiosk-grinding-planning-board', { category: 'grinding', view: 'resource' }]
    );
    expect(productionScheduleQueryKeys.grindingPlanningBoard()).toEqual(
      ['kiosk-grinding-planning-board', undefined]
    );
  });

  it('preserves grindingPlanningBoardLoad values and arity', () => {
    expect(productionScheduleQueryKeys.grindingPlanningBoardLoad('grinding')).toEqual(
      ['kiosk-grinding-planning-board', 'load', 'grinding']
    );
    expect(productionScheduleQueryKeys.grindingPlanningBoardLoad('cutting')).toEqual(
      ['kiosk-grinding-planning-board', 'load', 'cutting']
    );
  });

  it('preserves grindingPlanningBoardSnapshot values and arity', () => {
    expect(productionScheduleQueryKeys.grindingPlanningBoardSnapshot({ category: 'cutting', view: 'resource', cursor: 0 })).toEqual(
      ['kiosk-grinding-planning-board', 'snapshot', { category: 'cutting', view: 'resource', cursor: 0 }]
    );
    expect(productionScheduleQueryKeys.grindingPlanningBoardSnapshot()).toEqual(
      ['kiosk-grinding-planning-board', 'snapshot', undefined]
    );
  });

  it('preserves grindingPlanningBoardSeibanCandidates values and arity', () => {
    expect(productionScheduleQueryKeys.grindingPlanningBoardSeibanCandidates({ category: 'grinding', completionFilter: 'incomplete' })).toEqual(
      ['kiosk-grinding-planning-board', 'seiban-candidates', { category: 'grinding', completionFilter: 'incomplete' }]
    );
    expect(productionScheduleQueryKeys.grindingPlanningBoardSeibanCandidates()).toEqual(
      ['kiosk-grinding-planning-board', 'seiban-candidates', undefined]
    );
  });

  it('preserves grindingPlanningBoardDueDetail values and arity', () => {
    expect(productionScheduleQueryKeys.grindingPlanningBoardDueDetail('order-1')).toEqual(
      ['kiosk-grinding-planning-board-due-detail', 'order-1']
    );
    expect(productionScheduleQueryKeys.grindingPlanningBoardDueDetail('')).toEqual(
      ['kiosk-grinding-planning-board-due-detail', '']
    );
    expect(productionScheduleQueryKeys.grindingPlanningBoardDueDetail(null)).toEqual(
      ['kiosk-grinding-planning-board-due-detail', null]
    );
  });

  it('preserves leaderboardShell values and arity', () => {
    expect(productionScheduleQueryKeys.leaderboardShell({ resourceCds: 'resource-1', page: 1 })).toEqual(
      ['kiosk-production-schedule', 'leaderboard-shell', { resourceCds: 'resource-1', page: 1 }]
    );
    expect(productionScheduleQueryKeys.leaderboardShell()).toEqual(
      ['kiosk-production-schedule', 'leaderboard-shell', undefined]
    );
    expect(productionScheduleQueryKeys.leaderboardShell({})).toEqual(
      ['kiosk-production-schedule', 'leaderboard-shell', {}]
    );
  });

  it('preserves leaderboardTotal values and arity', () => {
    expect(productionScheduleQueryKeys.leaderboardTotal({ productNos: 'order-1', pageSize: 20 })).toEqual(
      ['kiosk-production-schedule', 'leaderboard-total', { productNos: 'order-1', pageSize: 20 }]
    );
    expect(productionScheduleQueryKeys.leaderboardTotal()).toEqual(
      ['kiosk-production-schedule', 'leaderboard-total', undefined]
    );
    expect(productionScheduleQueryKeys.leaderboardTotal({})).toEqual(
      ['kiosk-production-schedule', 'leaderboard-total', {}]
    );
  });

  it('preserves leaderboardBoard values and arity', () => {
    expect(productionScheduleQueryKeys.leaderboardBoard({ boardResourceCds: 'resource-1', targetDeviceScopeKey: 'device-1' })).toEqual(
      ['kiosk-production-schedule', 'leaderboard-board', { boardResourceCds: 'resource-1', targetDeviceScopeKey: 'device-1' }]
    );
    expect(productionScheduleQueryKeys.leaderboardBoard()).toEqual(
      ['kiosk-production-schedule', 'leaderboard-board', undefined]
    );
    expect(productionScheduleQueryKeys.leaderboardBoard({ boardResourceCds: '' })).toEqual(
      ['kiosk-production-schedule', 'leaderboard-board', { boardResourceCds: '' }]
    );
  });

  it('preserves leaderboardDecorations values and arity', () => {
    expect(productionScheduleQueryKeys.leaderboardDecorations('row-1\u0001row-2', 'device-1')).toEqual(
      ['kiosk-production-schedule', 'leaderboard-decorations', 'row-1\u0001row-2', 'device-1']
    );
    expect(productionScheduleQueryKeys.leaderboardDecorations('row-1')).toEqual(
      ['kiosk-production-schedule', 'leaderboard-decorations', 'row-1', '']
    );
    expect(productionScheduleQueryKeys.leaderboardDecorations('', undefined)).toEqual(
      ['kiosk-production-schedule', 'leaderboard-decorations', '', '']
    );
    expect(productionScheduleQueryKeys.leaderboardDecorations('', '')).toEqual(
      ['kiosk-production-schedule', 'leaderboard-decorations', '', '']
    );
  });

  it('preserves loadBalancingCapacityBase values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingCapacityBase('location-1')).toEqual(
      ['production-schedule-load-balancing-capacity-base', 'location-1']
    );
    expect(productionScheduleQueryKeys.loadBalancingCapacityBase('')).toEqual(
      ['production-schedule-load-balancing-capacity-base', '']
    );
  });

  it('preserves loadBalancingClasses values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingClasses('location-1')).toEqual(
      ['production-schedule-load-balancing-classes', 'location-1']
    );
    expect(productionScheduleQueryKeys.loadBalancingClasses('')).toEqual(
      ['production-schedule-load-balancing-classes', '']
    );
  });

  it('preserves loadBalancingTransferRules values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingTransferRules('location-1')).toEqual(
      ['production-schedule-load-balancing-transfer-rules', 'location-1']
    );
    expect(productionScheduleQueryKeys.loadBalancingTransferRules('')).toEqual(
      ['production-schedule-load-balancing-transfer-rules', '']
    );
  });

  it('preserves loadBalancingWorkCalendars values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingWorkCalendars('location-1')).toEqual(
      ['production-schedule-load-balancing-work-calendars', 'location-1']
    );
    expect(productionScheduleQueryKeys.loadBalancingWorkCalendars('')).toEqual(
      ['production-schedule-load-balancing-work-calendars', '']
    );
  });

  it('preserves loadBalancingMonthlyCapacity values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingMonthlyCapacity('location-1', '2026-10')).toEqual(
      ['production-schedule-load-balancing-monthly-capacity', 'location-1', '2026-10']
    );
    expect(productionScheduleQueryKeys.loadBalancingMonthlyCapacity('', '')).toEqual(
      ['production-schedule-load-balancing-monthly-capacity', '', '']
    );
    expect(productionScheduleQueryKeys.loadBalancingMonthlyCapacity(' location-1 ', ' 2026-10 ')).toEqual(
      ['production-schedule-load-balancing-monthly-capacity', ' location-1 ', ' 2026-10 ']
    );
  });

  it('preserves loadBalancingWorkspace values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingWorkspace({ fromMonth: '2026-10', toMonth: '2026-11', targetDeviceScopeKey: 'device-1' })).toEqual(
      ['kiosk-production-schedule-load-balancing-workspace', { fromMonth: '2026-10', toMonth: '2026-11', targetDeviceScopeKey: 'device-1' }]
    );
    expect(productionScheduleQueryKeys.loadBalancingWorkspace({ fromMonth: '', toMonth: '' })).toEqual(
      ['kiosk-production-schedule-load-balancing-workspace', { fromMonth: '', toMonth: '' }]
    );
  });

  it('preserves loadBalancingWorkspaceDay values and arity', () => {
    expect(productionScheduleQueryKeys.loadBalancingWorkspaceDay({ month: '2026-10', resourceCd: 'resource-1', fromMonth: '2026-09', toMonth: '2026-11', targetDeviceScopeKey: 'device-1' })).toEqual(
      ['kiosk-production-schedule-load-balancing-workspace-day', { month: '2026-10', resourceCd: 'resource-1', fromMonth: '2026-09', toMonth: '2026-11', targetDeviceScopeKey: 'device-1' }]
    );
    expect(productionScheduleQueryKeys.loadBalancingWorkspaceDay({ month: '', resourceCd: '' })).toEqual(
      ['kiosk-production-schedule-load-balancing-workspace-day', { month: '', resourceCd: '' }]
    );
  });

  it('preserves resourceCategorySettings values and arity', () => {
    expect(productionScheduleQueryKeys.resourceCategorySettings('location-1')).toEqual(
      ['production-schedule-resource-category-settings', 'location-1']
    );
    expect(productionScheduleQueryKeys.resourceCategorySettings('')).toEqual(
      ['production-schedule-resource-category-settings', '']
    );
  });

  it('preserves dueManagementAccessPasswordSettings values and arity', () => {
    expect(productionScheduleQueryKeys.dueManagementAccessPasswordSettings('location-1')).toEqual(
      ['production-schedule-due-management-access-password-settings', 'location-1']
    );
    expect(productionScheduleQueryKeys.dueManagementAccessPasswordSettings('')).toEqual(
      ['production-schedule-due-management-access-password-settings', '']
    );
  });

  it('preserves processingTypeOptions values and arity', () => {
    expect(productionScheduleQueryKeys.processingTypeOptions('location-1')).toEqual(
      ['production-schedule-processing-type-options', 'location-1']
    );
    expect(productionScheduleQueryKeys.processingTypeOptions('')).toEqual(
      ['production-schedule-processing-type-options', '']
    );
  });

  it('preserves resourceCodeMappings values and arity', () => {
    expect(productionScheduleQueryKeys.resourceCodeMappings('location-1')).toEqual(
      ['production-schedule-resource-code-mappings', 'location-1']
    );
    expect(productionScheduleQueryKeys.resourceCodeMappings('')).toEqual(
      ['production-schedule-resource-code-mappings', '']
    );
  });
});
