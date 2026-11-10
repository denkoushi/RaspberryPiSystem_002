import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { api, getResolvedClientKey } from '../../../../api/client';
import { useKioskGrindingPlanningBoardProgressive, useKioskGrindingPlanningBoardLoad, useKioskProductionScheduleResources, useKioskGrindingPlanningBoardSeibanCandidates, useKioskGrindingPlanningBoardDueDetail, useKioskGrindingPlanningBoardProcessChips } from '../../../../api/hooks';
import { collectPlanningBoardProcessChipParts } from '../planningBoardProcessChipData';

import { useFrozenValue, usePlanningBoardOffline } from './PlanningBoardOfflineProvider';

import type { KioskGrindingPlanningBoardQuery } from '../../../../api/client';
import type { MachineSignalResourceUptime } from '../../../../api/domains/machine-signal';
import type { DScheduleMinutesExtras } from '../../../../api/hooks/production-schedule/d-schedule-minutes';
import type {
  GrindingPlanningBoardResponse, GrindingPlanningBoardLoadResponse, GrindingPlanningBoardProcessChipsResponse,
  GrindingPlanningBoardSeibanCandidatesResponse, GrindingPlanningBoardDueScopeSnapshot,
  GrindingPlanningBoardResourceMinutesResponse, GrindingPlanningBoardResourceCapacityResponse,
  GrindingPlanningBoardCategory, GrindingPlanningBoardScheduleSource, GrindingPlanningBoardProcessChipsRequest
} from '@raspi-system/shared-types';

const base = '/kiosk/production-schedule/grinding-planning-board';
type Resources = { resources: string[]; resourceItems: { resourceCd: string; excluded: boolean }[]; resourceNameMap: Record<string, string[]> };
type Result<T> = { data: T | undefined; isError: boolean; error: unknown; scopeKey?: string };

/** This page's reads own their cancellation, generation and success reporting; no shared interceptors. */
function useOfflineRead<T>(key: string, scope: unknown, fetcher: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const offline = usePlanningBoardOffline();
  const { gate, registerRead, publishRead, subscribeFreeze } = offline;
  const latest = useRef({ fetcher, publishRead }); latest.current = { fetcher, publishRead };
  const [result, setResult] = useState<Result<T>>({ data: undefined, isError: false, error: null });
  const [fetching, setFetching] = useState(false);
  const inFlight = useRef<AbortController | undefined>(undefined);
  const scopeKey = JSON.stringify(scope);
  const activeScope = useRef(scopeKey); activeScope.current = scopeKey;
  useEffect(() => () => inFlight.current?.abort(), [scopeKey]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; inFlight.current?.abort(); }; }, []);
  const read = useCallback(async (signal: AbortSignal) => latest.current.fetcher(signal), []);
  const commit = useCallback((data: unknown) => {
    if (mounted.current) { setResult({ data: data as T, isError: false, error: null, scopeKey }); latest.current.publishRead(gate.generation()); }
  }, [scopeKey, gate]);
  useLayoutEffect(() => {
    if (!enabled) return;
    return registerRead(key, { read, commit });
  }, [key, scopeKey, enabled, read, commit, registerRead]);
  useEffect(() => subscribeFreeze(() => inFlight.current?.abort()), [subscribeFreeze]);
  const refetch = useCallback(async (): Promise<Result<T>> => {
    if (!gate.canWrite()) return { data: undefined, isError: true, error: new Error('Read only') };
    const generation = gate.generation();
    inFlight.current?.abort();
    const abort = new AbortController(); inFlight.current = abort;
    setFetching(true);
    try {
      const data = await read(abort.signal);
      if (abort.signal.aborted || generation !== gate.generation() || scopeKey !== activeScope.current) return { data: undefined, isError: true, error: new Error('Stale read') };
      const next = { data, isError: false, error: null, scopeKey }; if (mounted.current) { setResult(next); latest.current.publishRead(generation); } return next;
    } catch (error) {
      const next = { data: undefined, isError: true, error };
      if (mounted.current && !abort.signal.aborted && generation === gate.generation() && scopeKey === activeScope.current) setResult((previous) => previous.data ? previous : { ...next, scopeKey: previous.scopeKey });
      return next;
    } finally { if (mounted.current && inFlight.current === abort) setFetching(false); }
  }, [gate, read, scopeKey]);
  const previousScope = useRef(scopeKey);
  useEffect(() => {
    if (!enabled || offline.frozen) return;
    if (previousScope.current !== scopeKey || !result.data) void refetch();
    previousScope.current = scopeKey;
    const timer = setInterval(() => { void refetch(); }, 300_000);
    return () => clearInterval(timer);
  }, [scopeKey, enabled, offline.frozen, refetch, result.data]);
  const frozenResult = useFrozenValue(result);
  const visibleFetching = useFrozenValue(fetching);
  return { ...frozenResult, refetch, isFetching: visibleFetching, isLoading: !frozenResult.data && !frozenResult.isError,
    isPending: !frozenResult.data, isPlaceholderData: !!frozenResult.data && frozenResult.scopeKey !== scopeKey };
}

function useRequest() {
  const { gate, reportRead } = usePlanningBoardOffline();
  return async <T,>(path: string, signal: AbortSignal, valid: (data: T) => boolean,
    params?: unknown, body?: unknown): Promise<T> => {
    const generation = gate.generation(); const identity = getResolvedClientKey();
    const config = { signal, timeout: 15_000, params, headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } };
    const response = body === undefined ? await api.get<T>(path, config) : await api.post<T>(path, body, config);
    if (signal.aborted || identity !== getResolvedClientKey() || generation !== gate.generation() || response.status < 200 || response.status >= 300 || !response.data || typeof response.data !== 'object' || !valid(response.data)) throw new Error('Invalid board response');
    const finalUrl = response.request?.responseURL as string | undefined;
    if (finalUrl && !new URL(finalUrl, window.location.origin).pathname.endsWith(path)) throw new Error('Redirected board response');
    if (path.startsWith(base) || path === '/kiosk/production-schedule/resources' || path === '/kiosk/production-schedule/d-schedule-minutes') reportRead(generation, response.headers.date);
    return response.data;
  };
}

export function useOfflineBoard(params: KioskGrindingPlanningBoardQuery, _options?: unknown) {
  const request = useRequest();
  const query = useOfflineRead('board', params, async (signal) => {
    const first = await request<GrindingPlanningBoardResponse>(base, signal, (data) => Array.isArray(data.items) && typeof data.sourceRevision === 'string' && typeof data.siteKey === 'string', { ...params, includeLoad: false, cursor: 0, pageSize: 160 });
    const items = [...first.items]; const seen = new Set(items.map((item) => item.itemId));
    let cursor = first.nextCursor; let previous = 0;
    while (cursor != null) {
      const next = Number(cursor);
      if (!Number.isInteger(next) || next <= previous) throw new Error('Invalid cursor');
      const page = await request<GrindingPlanningBoardResponse>(base, signal, (data) => Array.isArray(data.items), { ...params, includeLoad: false, cursor: next, pageSize: 640, snapshotId: first.snapshotId });
      if (page.snapshotId !== first.snapshotId || page.sourceRevision !== first.sourceRevision || page.siteKey !== first.siteKey || page.category !== first.category || page.view !== first.view) throw new Error('Changed snapshot');
      for (const item of page.items) { if (seen.has(item.itemId)) throw new Error('Duplicate item'); seen.add(item.itemId); items.push(item); }
      previous = next; cursor = page.nextCursor;
    }
    return { ...first, items, nextCursor: null };
  });
  return { ...query, hasStableData: !!query.data && !query.isPlaceholderData, scopeReady: !!query.data && !query.isPlaceholderData, isComplete: !!query.data,
    isAppending: false, appendError: null };
}
export function useOfflineLoad(category: GrindingPlanningBoardCategory, scheduleSource?: GrindingPlanningBoardScheduleSource) {
  const request = useRequest();
  return useOfflineRead('load', { category, scheduleSource }, (signal) => request<GrindingPlanningBoardLoadResponse>(`${base}/load`, signal, (data) => Array.isArray(data.load), { category, scheduleSource }));
}
export function useOfflineResources(_options?: unknown) {
  const request = useRequest();
  return useOfflineRead('resources', null, async (signal) => {
    const data = await request<Resources>('/kiosk/production-schedule/resources', signal, (data) => Array.isArray(data.resources));
    return { ...data, resourceItems: data.resourceItems ?? data.resources.map((resourceCd) => ({ resourceCd, excluded: false })), resourceNameMap: data.resourceNameMap ?? {} };
  });
}
export function useOfflineCandidates(params: { category: GrindingPlanningBoardCategory; completionFilter?: 'all' | 'incomplete' }, options?: { enabled?: boolean }) {
  const request = useRequest();
  return useOfflineRead('candidates', params, (signal) => request<GrindingPlanningBoardSeibanCandidatesResponse>(`${base}/seiban-candidates`, signal, (data) => Array.isArray(data.candidates), params), options?.enabled);
}
export function useOfflineDueDetail(fseiban: string | null) {
  const request = useRequest();
  return useOfflineRead('due-detail', fseiban, (signal) => request<GrindingPlanningBoardDueScopeSnapshot>(`${base}/seiban/${encodeURIComponent(fseiban!)}/due-detail`, signal, (data) => !!data.alternate && !!data.original), !!fseiban);
}
export function useOfflineChips(parts: GrindingPlanningBoardProcessChipsRequest['parts'], scheduleSource?: GrindingPlanningBoardScheduleSource) {
  const request = useRequest(); const { stagedRead, snapshot } = usePlanningBoardOffline();
  return useOfflineRead('chips', { parts, scheduleSource }, async (signal) => {
    const staged = (snapshot.phase !== 'online' ? stagedRead('board') : undefined) as GrindingPlanningBoardResponse | undefined;
    const freshParts = staged ? collectPlanningBoardProcessChipParts(staged.items) : parts;
    const chipsByPartKey: GrindingPlanningBoardProcessChipsResponse['chipsByPartKey'] = {};
    for (let offset = 0; offset < freshParts.length; offset += 1000) {
      const data = await request<GrindingPlanningBoardProcessChipsResponse>(`${base}/process-chips`, signal, (data) => !!data.chipsByPartKey && typeof data.chipsByPartKey === 'object', { scheduleSource }, { parts: freshParts.slice(offset, offset + 1000) });
      Object.assign(chipsByPartKey, data.chipsByPartKey);
    }
    return { chipsByPartKey };
  });
}
export function useOfflineResourceMinutes(enabled: boolean) {
  const request = useRequest();
  return useOfflineRead('resource-minutes', null, (signal) => request<GrindingPlanningBoardResourceMinutesResponse>(`${base}/resource-minutes`, signal, (data) => Array.isArray(data.values) && Array.isArray(data.ownSourceResourceCds)), enabled);
}
export function useOfflineResourceCapacity(enabled: boolean) {
  const request = useRequest();
  return useOfflineRead('resource-capacity', null, (signal) => request<GrindingPlanningBoardResourceCapacityResponse>(`${base}/resource-capacity`, signal, (data) => !!data.dailyHoursByResource && Array.isArray(data.runsThroughBreaksResources)), enabled);
}

export function useOfflineDScheduleMinutes() {
  const request = useRequest();
  return useOfflineRead('d-schedule-minutes', null, (signal) => request<{ rows: DScheduleMinutesExtras[] }>('/kiosk/production-schedule/d-schedule-minutes', signal, (data) => Array.isArray(data.rows)));
}
export function useOfflineUptime(enabled: boolean) {
  const request = useRequest();
  return useOfflineRead('uptime', null, (signal) => request<MachineSignalResourceUptime>('/machine-signal/resource-uptime', signal, (data) => Array.isArray(data.resources), { days: 30 }), enabled);
}

export function usePlanningBoardPageQueries(params: KioskGrindingPlanningBoardQuery, options: {
  refetchIntervalMs: number | false | undefined; drawerOpen: boolean; showCompletedCandidates: boolean; dueDetailFseiban: string | null;
}) {
  const { enabled } = usePlanningBoardOffline();
  const useBoard = enabled ? useOfflineBoard : useKioskGrindingPlanningBoardProgressive;
  const useLoad = enabled ? useOfflineLoad : useKioskGrindingPlanningBoardLoad;
  const useCandidates = enabled ? useOfflineCandidates : useKioskGrindingPlanningBoardSeibanCandidates;
  const useResources = enabled ? useOfflineResources : useKioskProductionScheduleResources;
  const useDueDetail = enabled ? useOfflineDueDetail : useKioskGrindingPlanningBoardDueDetail;
  const boardQuery = useBoard(params, { refetchIntervalMs: options.refetchIntervalMs });
  const loadQuery = useLoad(params.category, params.scheduleSource);
  const candidateQuery = useCandidates({ category: params.category, completionFilter: options.showCompletedCandidates ? 'all' : 'incomplete' }, { enabled: options.drawerOpen });
  const resourcesQuery = useResources({ pauseRefetch: true });
  const dueDetailQuery = useDueDetail(options.dueDetailFseiban);
  return { boardQuery, loadQuery, candidateQuery, resourcesQuery, dueDetailQuery };
}
export function usePlanningBoardPageChips(parts: GrindingPlanningBoardProcessChipsRequest['parts'], scheduleSource?: GrindingPlanningBoardScheduleSource) {
  const { enabled } = usePlanningBoardOffline();
  const useChips = enabled ? useOfflineChips : useKioskGrindingPlanningBoardProcessChips;
  return useChips(parts, scheduleSource);
}
