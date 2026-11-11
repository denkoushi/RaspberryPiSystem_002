import { describe, expect, it } from 'vitest';

import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, readPlanningBoardOfflineConfig } from './planningBoardOfflineConfig';

describe('readPlanningBoardOfflineConfig', () => {
  it('defaults to disabled and returns a frozen config', () => {
    const config = readPlanningBoardOfflineConfig({});
    expect(config).toEqual({ enabled: false, lossAfterMs: 15000, refreshTimeoutMs: 45000, probeIntervalMs: 5000, probeTimeoutMs: 3000, recoverySuccesses: 2, recoveredBannerMs: 3000 });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reads explicit build values without changing the input', () => {
    const env = Object.freeze({
      VITE_PLANNING_BOARD_OFFLINE_ENABLED: 'true',
      VITE_PLANNING_BOARD_OFFLINE_LOSS_AFTER_MS: '20000',
      VITE_PLANNING_BOARD_OFFLINE_REFRESH_TIMEOUT_MS: '60000',
      VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS: '6000',
      VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS: '2000',
      VITE_PLANNING_BOARD_OFFLINE_RECOVERY_SUCCESSES: '3',
      VITE_PLANNING_BOARD_OFFLINE_RECOVERED_BANNER_MS: '0'
    });
    expect(readPlanningBoardOfflineConfig(env)).toEqual({ enabled: true, lossAfterMs: 20000, refreshTimeoutMs: 60000, probeIntervalMs: 6000, probeTimeoutMs: 2000, recoverySuccesses: 3, recoveredBannerMs: 0 });
    expect(readPlanningBoardOfflineConfig(env)).toEqual(readPlanningBoardOfflineConfig(env));
  });

  it.each(['', ' ', 'bad', 'NaN', 'Infinity', '-1'])('falls back on invalid numeric input %j', (raw) => {
    expect(readPlanningBoardOfflineConfig({
      VITE_PLANNING_BOARD_OFFLINE_LOSS_AFTER_MS: raw,
      VITE_PLANNING_BOARD_OFFLINE_REFRESH_TIMEOUT_MS: raw,
      VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS: raw,
      VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS: raw,
      VITE_PLANNING_BOARD_OFFLINE_RECOVERY_SUCCESSES: raw,
      VITE_PLANNING_BOARD_OFFLINE_RECOVERED_BANNER_MS: raw
    })).toEqual(DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG);
  });

  it.each(['0', '1.5', '-2'])('requires a positive integer success count: %s', (raw) => {
    expect(readPlanningBoardOfflineConfig({ VITE_PLANNING_BOARD_OFFLINE_RECOVERY_SUCCESSES: raw }).recoverySuccesses).toBe(2);
  });

  it.each([
    { VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS: '0' },
    { VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS: '0' },
    { VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS: '5000' },
    { VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS: '1000' },
    { VITE_PLANNING_BOARD_OFFLINE_LOSS_AFTER_MS: '4000' },
    { VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS: '20000', VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS: '18000' }
  ])('keeps timing constraints after fallback: %j', (env) => {
    const config = readPlanningBoardOfflineConfig(env);
    expect(config.probeTimeoutMs).toBeLessThan(config.probeIntervalMs);
    expect(config.lossAfterMs).toBeGreaterThanOrEqual(config.probeIntervalMs);
    expect(config.probeIntervalMs).toBeGreaterThan(0);
  });

  it('rejects a zero probe timeout but allows a zero banner duration', () => {
    const config = readPlanningBoardOfflineConfig({ VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS: '0', VITE_PLANNING_BOARD_OFFLINE_RECOVERED_BANNER_MS: '0' });
    expect(config.probeTimeoutMs).toBe(3000);
    expect(config.recoveredBannerMs).toBe(0);
  });

  it('allows lossAfter equal to interval', () => {
    expect(readPlanningBoardOfflineConfig({ VITE_PLANNING_BOARD_OFFLINE_LOSS_AFTER_MS: '5000' }).lossAfterMs).toBe(5000);
  });

  it.each(['false', '1', 'yes', 'invalid'])('does not enable implicitly: %s', (raw) => {
    expect(readPlanningBoardOfflineConfig({ VITE_PLANNING_BOARD_OFFLINE_ENABLED: raw }).enabled).toBe(false);
  });
});

it('rejects a zero refresh timeout', () => {
  expect(readPlanningBoardOfflineConfig({ VITE_PLANNING_BOARD_OFFLINE_REFRESH_TIMEOUT_MS: '0' }).refreshTimeoutMs).toBe(45000);
});
