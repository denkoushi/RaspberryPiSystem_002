import type { Logger } from 'pino';

/**
 * `setInterval` で起動される非同期処理が前回未完了のときに積み上がるのを防ぐ。
 * Alerts 系スケジューラー等で共通利用（境界の横断関心として集約）。
 */
export async function runExclusiveSchedulerTick(
  state: { locked: boolean },
  log: Logger | undefined,
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  if (state.locked) {
    log?.debug({ component: label }, 'Skipped overlapping scheduled tick');
    return;
  }
  state.locked = true;
  try {
    await fn();
  } finally {
    state.locked = false;
  }
}
