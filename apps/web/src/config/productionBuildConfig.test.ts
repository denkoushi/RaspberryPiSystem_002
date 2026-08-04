import { describe, expect, it } from 'vitest';

import { readProductionBuildConfig, resolveProductionDefaultClientKey } from './productionBuildConfig';

describe('productionBuildConfig', () => {
  it('uses the registry-generated production defaults when a build value is absent', () => {
    const config = readProductionBuildConfig({} as ImportMetaEnv);

    expect(config).toMatchObject({
      isDevelopment: false,
      agentWsMode: 'local',
      agentWsUrl: 'ws://localhost:7071/stream',
      apiBaseUrl: '/api',
      apiTimeoutMs: 120_000,
      barcodeAgentWsUrl: 'ws://localhost:7072/stream',
      debugLogsEnabled: false,
      dueManagementLayoutV2Enabled: true,
      leaderboardBoardClientPerfLog: false,
      leaderboardCacheWriteOnMutation: true,
      leaderboardDeferResidualSummaryEnabled: false,
      leaderboardSeibanOrClientFilter: true,
      leaderboardTerminalCacheEnabled: true,
      leaderboardTerminalCachePhase2Swr: true,
      manualOrderDeviceScopeV2Enabled: true,
      productionScheduleOrderSplitEnabled: false,
      sopPopupEnabled: true,
      targetLocationSelectorEnabled: true,
      wsBaseUrl: '/ws'
    });
    expect(config.defaultClientKey).toBeUndefined();
    expect(config.releaseSha).toBeUndefined();
  });

  it('parses explicit false and positive integer values without truthy coercion', () => {
    const config = readProductionBuildConfig({
      VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED: 'false',
      VITE_API_TIMEOUT_MS: '45000'
    } as ImportMetaEnv);

    expect(config.leaderboardTerminalCacheEnabled).toBe(false);
    expect(config.apiTimeoutMs).toBe(45_000);
  });

  it('does not synthesize a client key for a production build', () => {
    expect(
      resolveProductionDefaultClientKey({ isDevelopment: false, defaultClientKey: undefined })
    ).toBe('');
    expect(
      resolveProductionDefaultClientKey({
        isDevelopment: false,
        defaultClientKey: 'client-key-explicit-build-value',
      })
    ).toBe('client-key-explicit-build-value');
  });

  it('keeps the deterministic client key only for development', () => {
    expect(
      resolveProductionDefaultClientKey({ isDevelopment: true, defaultClientKey: undefined })
    ).toBe('client-key-raspberrypi4-kiosk1');
  });
});
