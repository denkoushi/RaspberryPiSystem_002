import { logger } from '../../lib/logger.js';

export type SignageSlideRotationState = {
  lastIndex: number;
  lastRenderedAt: number;
};

const LOG_EVENT = 'Signage rotating slide index calculated';

/**
 * PDF スライドショーやキオスク進捗ページングで共有する「最大1ページずつ進む」インデックス計算。
 * displayMode が SLIDESHOW かつ interval が正かつ stateKey があるときだけ状態を保持する。
 */
export function getRotatingSlideIndex(
  stateMap: Map<string, SignageSlideRotationState>,
  args: {
    stateKey: string | undefined;
    totalPages: number;
    displayMode: string;
    slideIntervalSeconds: number | null | undefined;
    logContext: Record<string, unknown>;
  }
): number {
  const { stateKey, totalPages, displayMode, slideIntervalSeconds, logContext } = args;
  const interval =
    slideIntervalSeconds === null || slideIntervalSeconds === undefined
      ? null
      : slideIntervalSeconds;

  if (totalPages === 0) {
    if (stateKey) {
      stateMap.delete(stateKey);
    }
    return 0;
  }

  if (displayMode === 'SLIDESHOW' && interval && interval > 0 && stateKey) {
    const now = Date.now();
    const slideIntervalMs = interval * 1000;
    const state = stateMap.get(stateKey);

    if (!state) {
      stateMap.set(stateKey, { lastIndex: 0, lastRenderedAt: now });
      logger.info(
        { ...logContext, totalPages, slideInterval: interval, lastIndex: 0, reason: 'initialized state' },
        LOG_EVENT
      );
      return 0;
    }

    const elapsed = now - state.lastRenderedAt;
    const steps = Math.floor(elapsed / slideIntervalMs);

    if (steps <= 0) {
      return state.lastIndex;
    }

    const nextIndex = (state.lastIndex + 1) % totalPages;
    stateMap.set(stateKey, { lastIndex: nextIndex, lastRenderedAt: now });

    logger.info(
      { ...logContext, totalPages, slideInterval: interval, elapsed, steps, nextIndex },
      LOG_EVENT
    );

    return nextIndex;
  }

  if (stateKey) {
    stateMap.delete(stateKey);
  }

  return 0;
}
