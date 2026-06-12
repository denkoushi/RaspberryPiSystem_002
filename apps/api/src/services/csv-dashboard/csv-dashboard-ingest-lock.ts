const chains = new Map<string, Promise<void>>();

/**
 * Process-local dashboard mutex for the full ingest pipeline.
 * It does not hold a DB connection while waiting; DB-level stale replacement guards still protect cross-process races.
 */
export async function withCsvDashboardIngestLock<T>(dashboardId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(dashboardId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current, () => current);
  chains.set(dashboardId, tail);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(dashboardId) === tail) {
      chains.delete(dashboardId);
    }
  }
}
