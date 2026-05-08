export type LeaderboardAppendAcquire = () => Promise<() => void>;

/**
 * Limits concurrent phased append (`leaderboard-shell` continue) requests across cards.
 * Each acquire waits for a slot; the returned release function must be called in `finally`.
 */
export function createLeaderboardAppendSemaphore(maxConcurrent: number): LeaderboardAppendAcquire {
  const cap = Math.max(1, Math.floor(maxConcurrent));
  let active = 0;
  const waiters: Array<() => void> = [];

  const tryDrain = (): void => {
    while (active < cap && waiters.length > 0) {
      const next = waiters.shift();
      if (next) next();
    }
  };

  return async () => {
    if (active < cap) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
      active += 1;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      tryDrain();
    };
  };
}
