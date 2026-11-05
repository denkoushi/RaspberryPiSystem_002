import { useMemo, useSyncExternalStore } from 'react';
import { buildLeaderBoardPartResourceProcessKey } from '../../../leaderOrderBoard/buildLeaderBoardPartResourceProcessKey';
import { productionFixture } from '../fixture';

const fixture = productionFixture();
const stores = Object.fromEntries(['board', 'chips', 'minutes', 'uptime', 'capacity', 'resources', 'load', 'candidates', 'detail'].map(key => [key, { data: undefined, listeners: new Set() }]));
const items = fixture.items.map((item, index) => ({ ...item, arrived: index % 4 !== 0, orderPinned: false }));
stores.board.data = { siteKey: 'perf-site', category: 'grinding', view: 'resource', sourceRevision: 'source-0', boardVersion: 1,
  registeredFseibans: fixture.seibans, seibanOrder: fixture.seibans, resources: fixture.resources,
  resourceCategories: Object.fromEntries(fixture.resources.map((cd, i) => [cd, i < 10 ? 'grinding' : 'cutting'])),
  items, load: [], unknownRequiredMinutesCount: 0, seibanProgress: {}, snapshotId: 'snapshot-0', nextCursor: null };
const chipsByPartKey = {};
for (const item of items) chipsByPartKey[buildLeaderBoardPartResourceProcessKey({ seibanJoinKey: item.fseiban, productNo: item.productNo, fhincd: item.fhincd })] =
  Array.from({ length: 6 }, (_, i) => ({ rowId: `${item.fhincd}-chip-${i}`, resourceCd: fixture.resources[i], processOrder: String((i + 1) * 10), isCompleted: i < 2 }));
stores.chips.data = { chipsByPartKey };
stores.minutes.data = { rows: fixture.seibans.map((fseiban, i) => ({ fseiban, outsourceMarks: [], memo: null,
  surfaceSendOutDates: i % 3 === 0 ? [{ date: '2026-11-06', note: null }, { date: '2026-11-10', note: null }] : [] })) };
stores.uptime.data = { resources: fixture.resources.map((resourceCd, i) => ({ resourceCd, averageRunSeconds: 20000 + i * 100 })) };
stores.capacity.data = { dailyHoursByResource: Object.fromEntries(fixture.resources.map(cd => [cd, 8])), runsThroughBreaksResources: [] };
stores.resources.data = { resourceNameMap: Object.fromEntries(fixture.resources.map(cd => [cd, [`機械${cd}`]])) };
stores.load.data = { load: [], unknownRequiredMinutesCount: 0 };
stores.candidates.data = { today: '2026-11-05', candidates: [], completionFilter: 'incomplete' };
stores.detail.data = undefined;

const refresh = keys => {
  for (const key of keys) {
    stores[key].data = structuredClone(stores[key].data);
    stores[key].listeners.forEach(listener => listener());
  }
};
window.perfHarness = { refresh, mutations: [], listenerCounts: () => Object.fromEntries(Object.entries(stores).map(([key, store]) => [key, store.listeners.size])) };
function useStore(key) {
  const store = stores[key];
  const data = useSyncExternalStore(listener => { store.listeners.add(listener); return () => store.listeners.delete(listener); }, () => store.data);
  return { data, isLoading: false, isFetching: false, isError: false, isPending: false,
    refetch: async () => { refresh(['board']); return { data: stores.board.data, isError: false }; },
    hasStableData: true, scopeReady: true, isComplete: true, isAppending: false, appendError: null };
}
const mutation = () => ({ mutateAsync: async (...args) => { window.perfHarness.mutations.push(args); return { sourceRevision: 'source-0', items: [] }; },
  mutate: (...args) => { window.perfHarness.mutations.push(args); }, isPending: false, isError: false });
export function useKioskGrindingPlanningBoardProgressive(params) {
  const result = useStore('board');
  const data = useMemo(() => ({ ...result.data, category: params.category, view: params.view }), [result.data, params.category, params.view]);
  return { ...result, data };
}
export const useKioskGrindingPlanningBoardProcessChips = () => useStore('chips');
export const useKioskGrindingPlanningBoardResourceCapacity = () => useStore('capacity');
export const useKioskProductionScheduleResources = () => useStore('resources');
export const useKioskGrindingPlanningBoardLoad = () => useStore('load');
export const useKioskGrindingPlanningBoardSeibanCandidates = () => useStore('candidates');
export const useKioskGrindingPlanningBoardDueDetail = () => useStore('detail');
export const useKioskDScheduleMinutes = () => useStore('minutes');
export const useMachineSignalResourceUptime = () => useStore('uptime');
export const useSetKioskProductionScheduleRowCompletion = mutation;
export const useUpdateKioskGrindingPlanningBoardResourceCapacity = mutation;
export const useUpdateKioskGrindingPlanningBoardPins = mutation;
export const useUpdateKioskGrindingPlanningBoardOverrides = mutation;
export const useUpdateKioskGrindingPlanningBoardDueScope = mutation;
export const useUpdateKioskGrindingPlanningBoardRank = mutation;
export const useUpdateKioskGrindingPlanningBoardResourceOrder = mutation;
export const useUpdateKioskGrindingPlanningBoardResourceOrderBulk = mutation;
export const useUpdateKioskGrindingPlanningBoardSeibanOrder = mutation;
