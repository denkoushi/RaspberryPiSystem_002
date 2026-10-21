import type {
  getKioskGrindingPlanningBoard,
  getKioskGrindingPlanningBoardProcessChips,
  getKioskGrindingPlanningBoardLoad,
  getKioskGrindingPlanningBoardSeibanCandidates,
  getKioskGrindingPlanningBoardSnapshot,
  getKioskProductionSchedule,
  getKioskProductionScheduleDueManagementDailyPlan,
  getKioskProductionScheduleDueManagementGlobalRank,
  getKioskProductionScheduleDueManagementGlobalRankProposal,
  getKioskProductionScheduleDueManagementManualOrderOverview,
  getKioskProductionScheduleDueManagementSummary,
  getKioskProductionScheduleDueManagementTriage,
  getKioskProductionScheduleLeaderboardBoard,
  getKioskProductionScheduleLeaderboardShell,
  getKioskProductionScheduleLeaderboardTotal,
  getKioskProductionScheduleLoadBalancingWorkspace,
  getKioskProductionScheduleLoadBalancingWorkspaceDay,
  getKioskProductionScheduleOrderSearchCandidates,
} from '../client';

export const productionScheduleQueryKeys = {
  scheduleAll: ['kiosk-production-schedule'] as const,
  schedule: (params?: Parameters<typeof getKioskProductionSchedule>[0]) =>
    ['kiosk-production-schedule', params] as const,
  orderSearch: (params?: Parameters<typeof getKioskProductionScheduleOrderSearchCandidates>[0]) =>
    ['kiosk-production-schedule-order-search', params] as const,
  resourcesAll: ['kiosk-production-schedule-resources'] as const,
  kioskProcessingTypeOptionsAll: ['kiosk-production-schedule-processing-type-options'] as const,
  orderUsageAll: ['kiosk-production-schedule-order-usage'] as const,
  searchStateAll: ['kiosk-production-schedule-search-state'] as const,
  searchHistoryAll: ['kiosk-production-schedule-search-history'] as const,
  historyProgressAll: ['kiosk-production-schedule-history-progress'] as const,
  progressOverviewAll: ['kiosk-production-schedule-progress-overview'] as const,
  orderUsage: (resourceCds?: string, targetDeviceScopeKey?: string) =>
    ['kiosk-production-schedule-order-usage', resourceCds, targetDeviceScopeKey] as const,
  seibanMachineNames: (keyFingerprint: string) =>
    ['kiosk-production-schedule-seiban-machine-names', keyFingerprint] as const,
  dueManagementSummaryAll: ['kiosk-production-schedule-due-management-summary'] as const,
  dueManagementSummary: (params?: Parameters<typeof getKioskProductionScheduleDueManagementSummary>[0]) =>
    ['kiosk-production-schedule-due-management-summary', params] as const,
  dueManagementTriageAll: ['kiosk-production-schedule-due-management-triage'] as const,
  dueManagementTriage: (params?: Parameters<typeof getKioskProductionScheduleDueManagementTriage>[0]) =>
    ['kiosk-production-schedule-due-management-triage', params] as const,
  dueManagementDailyPlanAll: ['kiosk-production-schedule-due-management-daily-plan'] as const,
  dueManagementDailyPlan: (params?: Parameters<typeof getKioskProductionScheduleDueManagementDailyPlan>[0]) =>
    ['kiosk-production-schedule-due-management-daily-plan', params] as const,
  dueManagementGlobalRankAll: ['kiosk-production-schedule-due-management-global-rank'] as const,
  dueManagementGlobalRank: (params?: Parameters<typeof getKioskProductionScheduleDueManagementGlobalRank>[0]) =>
    ['kiosk-production-schedule-due-management-global-rank', params] as const,
  dueManagementManualOrderOverviewAll: ['kiosk-production-schedule-due-management-manual-order-overview'] as const,
  dueManagementManualOrderOverview: (params?: Parameters<typeof getKioskProductionScheduleDueManagementManualOrderOverview>[0]) =>
    ['kiosk-production-schedule-due-management-manual-order-overview', params] as const,
  dueManagementGlobalRankProposalAll: ['kiosk-production-schedule-due-management-global-rank-proposal'] as const,
  dueManagementGlobalRankProposal: (params?: Parameters<typeof getKioskProductionScheduleDueManagementGlobalRankProposal>[0]) =>
    ['kiosk-production-schedule-due-management-global-rank-proposal', params] as const,
  dueManagementSeibanAll: (fseiban: string | null) =>
    ['kiosk-production-schedule-due-management-seiban', fseiban] as const,
  dueManagementSeiban: (fseiban: string | null, context?: Parameters<typeof getKioskProductionScheduleDueManagementSummary>[0]) =>
    ['kiosk-production-schedule-due-management-seiban', fseiban, context] as const,
  manualOrderSiteDevices: (siteKey?: string) =>
    ['kiosk-production-schedule-manual-order-site-devices', siteKey] as const,
  manualOrderResourceAssignmentsAll: ['kiosk-production-schedule-manual-order-resource-assignments'] as const,
  manualOrderResourceAssignments: (siteKey?: string) =>
    ['kiosk-production-schedule-manual-order-resource-assignments', siteKey] as const,
  grindingPlanningBoardAll: ['kiosk-grinding-planning-board'] as const,
  grindingPlanningBoardProcessChips: (parts: Parameters<typeof getKioskGrindingPlanningBoardProcessChips>[0]['parts']) =>
    ['kiosk-grinding-planning-board', 'process-chips', parts] as const,
  grindingPlanningBoard: (params?: Parameters<typeof getKioskGrindingPlanningBoard>[0]) =>
    ['kiosk-grinding-planning-board', params] as const,
  grindingPlanningBoardLoadAll: ['kiosk-grinding-planning-board', 'load'] as const,
  grindingPlanningBoardLoad: (category: Parameters<typeof getKioskGrindingPlanningBoardLoad>[0]) =>
    ['kiosk-grinding-planning-board', 'load', category] as const,
  grindingPlanningBoardSnapshot: (params?: Parameters<typeof getKioskGrindingPlanningBoardSnapshot>[0]) =>
    ['kiosk-grinding-planning-board', 'snapshot', params] as const,
  grindingPlanningBoardSeibanCandidates: (params?: Parameters<typeof getKioskGrindingPlanningBoardSeibanCandidates>[0]) =>
    ['kiosk-grinding-planning-board', 'seiban-candidates', params] as const,
  grindingPlanningBoardDueDetail: (fseiban: string | null) =>
    ['kiosk-grinding-planning-board-due-detail', fseiban] as const,
  planningBoardResourceCapacityAll: ['kiosk-planning-board-resource-capacity'] as const,
  leaderboardShellAll: ['kiosk-production-schedule', 'leaderboard-shell'] as const,
  leaderboardShell: (params?: Parameters<typeof getKioskProductionScheduleLeaderboardShell>[0]) =>
    ['kiosk-production-schedule', 'leaderboard-shell', params] as const,
  leaderboardTotalAll: ['kiosk-production-schedule', 'leaderboard-total'] as const,
  leaderboardTotal: (params?: Parameters<typeof getKioskProductionScheduleLeaderboardTotal>[0]) =>
    ['kiosk-production-schedule', 'leaderboard-total', params] as const,
  leaderboardBoardAll: ['kiosk-production-schedule', 'leaderboard-board'] as const,
  leaderboardBoard: (params?: Parameters<typeof getKioskProductionScheduleLeaderboardBoard>[0]) =>
    ['kiosk-production-schedule', 'leaderboard-board', params] as const,
  leaderboardDecorationsAll: ['kiosk-production-schedule', 'leaderboard-decorations'] as const,
  leaderboardDecorations: (rowFingerprint: string, targetDeviceScopeKey?: string) =>
    ['kiosk-production-schedule', 'leaderboard-decorations', rowFingerprint, targetDeviceScopeKey ?? ''] as const,
  loadBalancingCapacityBase: (location: string) =>
    ['production-schedule-load-balancing-capacity-base', location] as const,
  loadBalancingClasses: (location: string) => ['production-schedule-load-balancing-classes', location] as const,
  loadBalancingTransferRules: (location: string) =>
    ['production-schedule-load-balancing-transfer-rules', location] as const,
  loadBalancingWorkCalendars: (location: string) =>
    ['production-schedule-load-balancing-work-calendars', location] as const,
  loadBalancingMonthlyCapacity: (location: string, yearMonth: string) =>
    ['production-schedule-load-balancing-monthly-capacity', location, yearMonth] as const,
  loadBalancingWorkspaceAll: ['kiosk-production-schedule-load-balancing-workspace'] as const,
  loadBalancingWorkspace: (params: Parameters<typeof getKioskProductionScheduleLoadBalancingWorkspace>[0]) =>
    ['kiosk-production-schedule-load-balancing-workspace', params] as const,
  loadBalancingWorkspaceDayAll: ['kiosk-production-schedule-load-balancing-workspace-day'] as const,
  loadBalancingWorkspaceDay: (params: Parameters<typeof getKioskProductionScheduleLoadBalancingWorkspaceDay>[0]) =>
    ['kiosk-production-schedule-load-balancing-workspace-day', params] as const,
  resourceCategorySettings: (location: string) => ['production-schedule-resource-category-settings', location] as const,
  dueManagementAccessPasswordSettings: (location: string) =>
    ['production-schedule-due-management-access-password-settings', location] as const,
  processingTypeOptions: (location: string) => ['production-schedule-processing-type-options', location] as const,
  resourceCodeMappings: (location: string) => ['production-schedule-resource-code-mappings', location] as const,
  orderSplitPilotSettingsAll: ['production-schedule-order-split-pilot-settings'] as const,
  orderSplitStatusAll: ['kiosk-production-schedule-order-split-status'] as const,
  dueManagementSeibanDetailAll: ['kiosk-production-schedule-due-management-seiban-detail'] as const,
};
