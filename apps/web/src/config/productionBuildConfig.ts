/**
 * Sole application boundary for immutable Vite production settings.
 *
 * Do not read `import.meta.env.VITE_*` outside this module. The deploy contract
 * audits this module against every Ansible/Docker/release surface.
 */
import { PRODUCTION_WEB_IMAGE_DEFAULTS as defaults } from './productionBuildDefaults.generated';

type ViteEnvironment = ImportMetaEnv;

const booleanValue = (value: string | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const generatedBoolean = (value: string): boolean => value === 'true';

const positiveInteger = (value: string | undefined, fallback: number): number => {
  if (!value || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
};

export interface ProductionBuildConfig {
  isDevelopment: boolean;
  agentWsMode: string;
  agentWsUrl: string;
  apiBaseUrl: string;
  apiTimeoutMs: number;
  barcodeAgentWsUrl: string;
  defaultClientKey?: string;
  debugLogsEnabled: boolean;
  dueManagementLayoutV2Enabled: boolean;
  leaderboardBoardClientPerfLog: boolean;
  leaderboardCacheWriteOnMutation: boolean;
  leaderboardDeferResidualSummaryEnabled: boolean;
  leaderboardSeibanOrClientFilter: boolean;
  leaderboardTerminalCacheEnabled: boolean;
  leaderboardTerminalCachePhase2Swr: boolean;
  manualOrderDeviceScopeV2Enabled: boolean;
  productionScheduleOrderSplitEnabled: boolean;
  sopPopupEnabled: boolean;
  targetLocationSelectorEnabled: boolean;
  releaseSha?: string;
  wsBaseUrl: string;
}

export const readProductionBuildConfig = (
  env: ViteEnvironment = import.meta.env
): ProductionBuildConfig => ({
  isDevelopment: env.DEV === true,
  agentWsMode: String(env.VITE_AGENT_WS_MODE ?? defaults.VITE_AGENT_WS_MODE).toLowerCase(),
  agentWsUrl: env.VITE_AGENT_WS_URL ?? defaults.VITE_AGENT_WS_URL,
  apiBaseUrl: env.VITE_API_BASE_URL ?? defaults.VITE_API_BASE_URL,
  apiTimeoutMs: positiveInteger(
    env.VITE_API_TIMEOUT_MS,
    Number(defaults.VITE_API_TIMEOUT_MS)
  ),
  barcodeAgentWsUrl:
    env.VITE_BARCODE_AGENT_WS_URL ?? defaults.VITE_BARCODE_AGENT_WS_URL,
  defaultClientKey: env.VITE_DEFAULT_CLIENT_KEY || undefined,
  debugLogsEnabled: booleanValue(
    env.VITE_ENABLE_DEBUG_LOGS,
    generatedBoolean(defaults.VITE_ENABLE_DEBUG_LOGS)
  ),
  dueManagementLayoutV2Enabled: booleanValue(
    env.VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED)
  ),
  leaderboardBoardClientPerfLog: booleanValue(
    env.VITE_KIOSK_LEADERBOARD_BOARD_CLIENT_PERF_LOG,
    generatedBoolean(defaults.VITE_KIOSK_LEADERBOARD_BOARD_CLIENT_PERF_LOG)
  ),
  leaderboardCacheWriteOnMutation: booleanValue(
    env.VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION,
    generatedBoolean(defaults.VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION)
  ),
  leaderboardDeferResidualSummaryEnabled: booleanValue(
    env.VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED)
  ),
  leaderboardSeibanOrClientFilter: booleanValue(
    env.VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER,
    generatedBoolean(defaults.VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER)
  ),
  leaderboardTerminalCacheEnabled: booleanValue(
    env.VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED)
  ),
  leaderboardTerminalCachePhase2Swr: booleanValue(
    env.VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR,
    generatedBoolean(defaults.VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR)
  ),
  manualOrderDeviceScopeV2Enabled: booleanValue(
    env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED)
  ),
  productionScheduleOrderSplitEnabled: booleanValue(
    env.VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED)
  ),
  sopPopupEnabled: booleanValue(
    env.VITE_KIOSK_SOP_POPUP_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_SOP_POPUP_ENABLED)
  ),
  targetLocationSelectorEnabled: booleanValue(
    env.VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED,
    generatedBoolean(defaults.VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED)
  ),
  releaseSha: env.VITE_RELEASE_SHA || undefined,
  wsBaseUrl: env.VITE_WS_BASE_URL ?? defaults.VITE_WS_BASE_URL
});
