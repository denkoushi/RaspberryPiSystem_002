export type BoardOfflineConfig = Readonly<{
  enabled: boolean;
  lossAfterMs: number;
  probeIntervalMs: number;
  probeTimeoutMs: number;
  recoverySuccesses: number;
  recoveredBannerMs: number;
}>;

type OfflineEnv = Pick<ImportMetaEnv,
  | 'VITE_PLANNING_BOARD_OFFLINE_ENABLED'
  | 'VITE_PLANNING_BOARD_OFFLINE_LOSS_AFTER_MS'
  | 'VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS'
  | 'VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS'
  | 'VITE_PLANNING_BOARD_OFFLINE_RECOVERY_SUCCESSES'
  | 'VITE_PLANNING_BOARD_OFFLINE_RECOVERED_BANNER_MS'
>;

export const DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG: BoardOfflineConfig = Object.freeze({
  enabled: false,
  lossAfterMs: 15_000,
  probeIntervalMs: 5_000,
  probeTimeoutMs: 3_000,
  recoverySuccesses: 2,
  recoveredBannerMs: 3_000
});

function numeric(raw: string | undefined, fallback: number, positive = false): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && (positive ? value > 0 : value >= 0) ? value : fallback;
}

/** The caller passes the build-time env object; this parser has no global reads. */
export function readPlanningBoardOfflineConfig(env: OfflineEnv): BoardOfflineConfig {
  const defaults = DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG;
  let probeIntervalMs = numeric(env.VITE_PLANNING_BOARD_OFFLINE_PROBE_INTERVAL_MS, defaults.probeIntervalMs, true);
  let probeTimeoutMs = numeric(env.VITE_PLANNING_BOARD_OFFLINE_PROBE_TIMEOUT_MS, defaults.probeTimeoutMs);
  let lossAfterMs = numeric(env.VITE_PLANNING_BOARD_OFFLINE_LOSS_AFTER_MS, defaults.lossAfterMs);
  if (probeTimeoutMs >= probeIntervalMs) {
    probeTimeoutMs = defaults.probeTimeoutMs;
    if (probeTimeoutMs >= probeIntervalMs) probeIntervalMs = defaults.probeIntervalMs;
  }
  if (lossAfterMs < probeIntervalMs) {
    lossAfterMs = defaults.lossAfterMs;
    if (lossAfterMs < probeIntervalMs) probeIntervalMs = defaults.probeIntervalMs;
  }
  // Reset the timing group if restoring interval made an otherwise valid timeout invalid.
  if (probeTimeoutMs >= probeIntervalMs) probeTimeoutMs = defaults.probeTimeoutMs;
  const successes = numeric(env.VITE_PLANNING_BOARD_OFFLINE_RECOVERY_SUCCESSES, defaults.recoverySuccesses, true);
  return Object.freeze({
    enabled: env.VITE_PLANNING_BOARD_OFFLINE_ENABLED === 'true',
    lossAfterMs,
    probeIntervalMs,
    probeTimeoutMs,
    recoverySuccesses: Number.isInteger(successes) ? successes : defaults.recoverySuccesses,
    recoveredBannerMs: numeric(env.VITE_PLANNING_BOARD_OFFLINE_RECOVERED_BANNER_MS, defaults.recoveredBannerMs)
  });
}
