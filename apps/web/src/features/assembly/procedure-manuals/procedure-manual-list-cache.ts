import type { getProcedureManualOverview, listProcedureManualCommon, listProcedureManualModels, listProcedureManualParts, listProcedureManualProcesses } from '../../../api/client';

type Lists = {
  processes: Awaited<ReturnType<typeof listProcedureManualProcesses>>;
  models: Awaited<ReturnType<typeof listProcedureManualModels>>;
  parts: Awaited<ReturnType<typeof listProcedureManualParts>>;
  overview: Awaited<ReturnType<typeof getProcedureManualOverview>>;
  publishedOverview: Awaited<ReturnType<typeof getProcedureManualOverview>>;
  common: Awaited<ReturnType<typeof listProcedureManualCommon>>;
  publishedCommon: Awaited<ReturnType<typeof listProcedureManualCommon>>;
  materialCount: number;
  videoCount: number;
};
const cache = new Map<keyof Lists, { value: Lists[keyof Lists]; expires: number }>();
const pending = new Map<keyof Lists, Promise<unknown>>();
const lifetime = 3 * 60 * 1000;
let generation = 0;

export function readManualList<K extends keyof Lists>(key: K): Lists[K] | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) { cache.delete(key); return undefined; }
  return entry.value as Lists[K];
}

export function retainEqual<T>(current: T, next: T): T {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

// Revalidate cached values, sharing only requests from the current generation.
export function fetchManualList<K extends keyof Lists>(key: K, load: () => Promise<Lists[K]>): Promise<Lists[K]> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<Lists[K]>;
  const started = generation;
  const request = load().then(next => {
    const value = retainEqual(readManualList(key), next) as Lists[K];
    if (started === generation) cache.set(key, { value, expires: Date.now() + lifetime });
    return value;
  }).finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

export function clearManualLists({ preserveProcesses = false } = {}) {
  generation += 1;
  const processes = preserveProcesses ? cache.get('processes') : undefined;
  cache.clear(); pending.clear();
  if (processes) cache.set('processes', processes);
}
