import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { httpStatus, procedureBoardApi } from './procedureBoardApi';
import { boardItems, normalizeLayout } from './procedureBoardLayout';

import type { BoardEvent, BoardResponse, Decision, FormatProposal, Suggestions } from './procedureBoardApi';
import type { BoardLayout } from './procedureBoardLayout';

export type BoardChange = (layout: BoardLayout) => { layout: BoardLayout; event: Omit<BoardEvent, 'id'> };
type State = { board?: BoardResponse; draft?: BoardLayout; latest?: BoardResponse; recovery?: BoardLayout;
  suggestions?: Suggestions; format?: FormatProposal; pending: number; forbidden: boolean; error?: string; busy: boolean; stopped: boolean };
type Work = { workId: string; materialId: string; activeMs: number; tick: number; activity: number; completed: boolean };
type Job = { id: string; change?: BoardChange; run?: (board: BoardResponse) => Promise<BoardResponse | void>; events?: BoardEvent[]; work?: Work; attempted?: boolean };

// One session per route. All writes (including display events and AI decisions) use this queue.
function createSession(procedureId: string, refreshProposals: (proposalId?: string) => Promise<FormatProposal | undefined>) {
  let state: State = { pending: 0, forbidden: false, busy: false, stopped: false };
  let active = true; let generation = 0; let running = false; let timer: ReturnType<typeof setTimeout> | undefined;
  let deferred: Suggestions | undefined; let work: Work | undefined; let retryMs = 0; let retryAt = 0;
  const jobs: Job[] = []; const listeners = new Set<() => void>(); const shown = new Set<string>();
  const publish = (patch: Partial<State>) => {
    if (!active) return;
    state = { ...state, ...patch, pending: jobs.length }; listeners.forEach(listener => listener());
  };
  const fail = async (error: unknown) => {
    const status = httpStatus(error);
    publish({ forbidden: status === 403 || state.forbidden, stopped: true,
      error: status === 403 ? '手順づくりは無効です' : status === 409 ? '盤面が更新されています。下書きは保持しています。' : '保存できませんでした。下書きは保持しています。' });
    if (status === 409) {
      try { publish({ latest: await procedureBoardApi.get(procedureId) }); }
      catch (refreshError) { if (httpStatus(refreshError) === 403) publish({ forbidden: true }); }
    }
  };
  const readError = (error: unknown) => {
    if (httpStatus(error) === 403) void fail(error);
  };
  async function flush() {
    clearTimeout(timer);
    if (running || state.stopped || !state.board || !active) return;
    running = true;
    try {
      while (jobs.length && !state.stopped && active) {
        const job = jobs[0]; const before = state.board!;
        job.attempted = true;
        try {
          const change = job.change?.(before.layout);
          if (change && job.work) {
            tickWork(job.work);
            change.event.payload = { ...change.event.payload, materialId: job.work.materialId, workId: job.work.workId, activeMs: Math.floor(job.work.activeMs) };
          }
          const result = job.events ? (await procedureBoardApi.events(procedureId, before.version, job.events), undefined) : change ? await procedureBoardApi.save(procedureId, before.version, change.layout, { ...change.event, id: job.id })
            : await job.run!(before);
          if (!active) break;
          jobs.shift(); retryMs = 0; retryAt = 0;
          if (job.work) { tickWork(job.work); job.work.completed = true; recordWork(job.work); }
          if (result) {
            // Reapply edits made while the request was in flight; never replace them with a late response.
            let draft = result.layout;
            for (const queued of jobs) if (queued.change) draft = queued.change(draft).layout;
            publish({ board: result, draft: JSON.stringify(draft) === JSON.stringify(state.draft) ? state.draft : draft, error: undefined });
          } else publish({ error: undefined });
        } catch (error) {
          if (!active) break;
          const status = httpStatus(error);
          const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
          if (status === 409 && code === 'PROCEDURE_BOARD_SUGGESTION_STALE') {
            jobs.shift(); retryMs = 0; retryAt = 0;
            publish({ suggestions: undefined });
            try {
              const format = await refreshProposals(state.format?.proposalId);
              if (format) publish({ format });
            } catch (refreshError) { readError(refreshError); }
            continue;
          }
          if (status === undefined || status >= 500) {
            retryMs = Math.min(retryMs ? retryMs * 2 : 1000, 30000);
            retryAt = Date.now() + retryMs;
            publish({ error: '保存できませんでした。下書きは保持しています。' });
            schedule();
          } else await fail(error);
          break;
        }
      }
    } finally {
      running = false;
      if (!state.busy && !jobs.length && deferred) { const next = deferred; deferred = undefined; void receive(next); }
    }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void flush(), retryAt ? Math.max(0, retryAt - Date.now()) : 300); };
  const enqueue = (job: Job) => { jobs.push(job); publish({}); schedule(); };
  const receive = async (suggestions: Suggestions) => {
    if (state.busy || jobs.length || running) { deferred = suggestions; return; }
    if (!state.board || state.stopped) return;
    if (suggestions.boardVersion < state.board.version) return;
    if (suggestions.boardVersion > state.board.version) {
      try {
        const latest = await procedureBoardApi.get(procedureId);
        if (state.busy || jobs.length || running) { deferred = suggestions; return; }
        if (latest.version < state.board!.version) return;
        if (latest.version > state.board!.version) publish({ board: latest, draft: latest.layout });
        if (latest.version !== suggestions.boardVersion) return;
      } catch (error) { readError(error); return; }
    }
    publish({ suggestions });
  };
  function append(events: BoardEvent[]) {
    if (state.forbidden || state.stopped || !state.board || !events.length) return;
    const previous = jobs[jobs.length - 1];
    if (previous?.events && !previous.attempted && previous.events.length + events.length <= 100) {
      previous.events.push(...events); schedule();
    } else enqueue({ id: crypto.randomUUID(), events });
  }
  function show(proposalId: string) {
    const set = state.suggestions?.current;
    const proposal = set?.placements.find(proposal => proposal.id === proposalId);
    if (document.visibilityState === 'hidden' || !set || !proposal || set.stale || set.boardVersion !== state.board?.version || shown.has(`${set.id}:${proposalId}`)) return;
    shown.add(`${set.id}:${proposalId}`);
    append([{ id: crypto.randomUUID(), type: 'placement_shown', payload: { suggestionSetId: set.id, proposalId, materialId: proposal.materialId } }]);
  }
  function tickWork(value: Work) {
    const now = Date.now();
    if (document.visibilityState !== 'hidden') value.activeMs = Math.min(86400000, value.activeMs + Math.max(0, Math.min(now, value.activity + 60000) - value.tick));
    value.tick = now;
  }
  function recordWork(value: Work) {
    append([{ id: crypto.randomUUID(), type: 'material_work', payload: { materialId: value.materialId, workId: value.workId,
      activeMs: Math.floor(value.activeMs), completed: value.completed } }]);
  }
  function touch(materialId?: string) {
    if (state.forbidden || state.stopped) return;
    if (work) { tickWork(work); work.activity = Date.now(); }
    if (materialId && (work?.materialId !== materialId || work.completed)) {
      if (work && !work.completed) recordWork(work);
      work = { workId: crypto.randomUUID(), materialId, activeMs: 0, tick: Date.now(), activity: Date.now(), completed: false };
    }
  }

  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    start: () => {
      active = true; const token = ++generation;
      void procedureBoardApi.open(procedureId).then(board => { if (active && token === generation) { publish({ board, draft: board.layout }); schedule(); } }).catch(error => { if (active && token === generation) void fail(error); });
      const interval = setInterval(() => { if (work && !work.completed) { tickWork(work); recordWork(work); } }, 10000);
      const visibility = () => {
        if (work && !work.completed) {
          if (document.visibilityState === 'hidden') {
            const now = Date.now(); work.activeMs = Math.min(86400000, work.activeMs + Math.max(0, Math.min(now, work.activity + 60000) - work.tick)); work.tick = now; recordWork(work);
          } else work.tick = Date.now();
        }
      };
      document.addEventListener('visibilitychange', visibility);
      return () => { active = false; ++generation; clearTimeout(timer); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); };
    },
    readError, show, touch,
    change: (change: BoardChange, mergeKey?: string) => {
      if (!state.draft || state.forbidden || state.stopped) return;
      try {
        const next = change(state.draft);
        if (JSON.stringify(next.layout) === JSON.stringify(state.draft)) return;
        const id = next.event.payload.itemId;
        const material = boardItems(next.layout).find(entry => entry.item.itemId === id)?.item ?? boardItems(state.draft).find(entry => entry.item.itemId === id)?.item;
        const operationWork = material?.kind === 'material' && !['item_duplicated', 'text_created'].includes(next.event.type) && work?.materialId === material.materialId ? work : undefined;
        const previous = jobs[jobs.length - 1];
        // Only same-item text edits / same-row widths may share a PUT under the single-event API.
        if (mergeKey && !previous?.attempted && previous?.change &&
          (previous as Job & { mergeKey?: string }).mergeKey === mergeKey) {
          previous.change = change;
        } else jobs.push(Object.assign({ id: crypto.randomUUID(), change, work: operationWork }, { mergeKey }));
        publish({ draft: next.layout }); schedule();
      } catch { publish({ error: 'この場所には置けません' }); }
    },
    busy: (busy: boolean) => {
      publish({ busy });
      if (!busy && deferred) { const next = deferred; deferred = undefined; void receive(next); }
    },
    receive,
    decide: (setId: string, decision: Decision) => {
      if (state.forbidden || state.stopped || state.suggestions?.current?.id !== setId || jobs.some(job => job.change)
        || state.suggestions.boardVersion !== state.board?.version) return;
      show(decision.proposalId);
      const materialId = state.suggestions.current?.placements.find(proposal => proposal.id === decision.proposalId)?.materialId;
      const operationWork = materialId && work?.materialId === materialId ? work : undefined;
      const id = crypto.randomUUID();
      enqueue({ id, work: operationWork, run: board => {
        if (operationWork) tickWork(operationWork);
        return procedureBoardApi.decide(procedureId, setId, board.version, { ...decision, ...(operationWork ? { workId: operationWork.workId, activeMs: Math.floor(operationWork.activeMs) } : {}) }, id);
      } });
    },
    requestFormat: () => {
      if (state.forbidden || state.stopped) return;
      const requestId = crypto.randomUUID();
      enqueue({ id: requestId, run: async board => { publish({ format: await procedureBoardApi.requestFormat(procedureId, board.version, requestId) }); } });
    },
    receiveFormat: (format: FormatProposal) => { publish({ format }); },
    decideFormat: (action: 'accept' | 'revert') => {
      if (!state.format || state.forbidden || state.stopped) return;
      const proposalId = state.format.proposalId; const id = crypto.randomUUID();
      enqueue({ id, run: async board => {
        const result = await procedureBoardApi.decideFormat(procedureId, proposalId, board.version, action, id);
        publish({ format: undefined }); return result;
      } });
    },
    refresh: async () => {
      try { publish({ latest: await procedureBoardApi.get(procedureId) }); } catch (error) { readError(error); }
    },
    latest: () => {
      if (!state.latest || state.forbidden) return;
      let draft = state.latest.layout;
      const retained = jobs.filter(job => {
        if (!job.change) return true;
        try { draft = job.change(draft).layout; return true; } catch { return false; }
      });
      jobs.splice(0, jobs.length, ...retained);
      retryMs = 0; retryAt = 0;
      publish({ recovery: state.draft, board: state.latest, draft, latest: undefined, stopped: false, error: undefined });
      schedule();
    },
    recover: () => { if (state.recovery) publish({ draft: state.recovery, recovery: state.draft, latest: state.board, stopped: true, error: '保存していない下書き' }); },
  };
}

export function useProcedureBoard(procedureId: string) {
  const queryClient = useQueryClient();
  const session = useMemo(() => createSession(procedureId, async proposalId => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['procedure-board', procedureId, 'suggestions'] }),
      queryClient.invalidateQueries({ queryKey: ['procedure-board', procedureId, 'format'] }),
    ]);
    if (proposalId) {
      try {
        return await queryClient.fetchQuery({ queryKey: ['procedure-board', procedureId, 'format', proposalId],
          queryFn: () => procedureBoardApi.format(procedureId, proposalId), staleTime: 0, retry: false });
      } catch (error) { if (httpStatus(error) === 403) throw error; }
    }
  }), [procedureId, queryClient]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => session.start(), [session]);
  const suggestions = useQuery({ queryKey: ['procedure-board', procedureId, 'suggestions'],
    queryFn: () => procedureBoardApi.suggestions(procedureId), enabled: !!state.board && !state.forbidden && !state.stopped,
    notifyOnChangeProps: state.busy ? [] : ['data', 'error'],
    retry: false, refetchInterval: query => query.state.data?.pollAfterMs ?? 5000, refetchIntervalInBackground: false });
  useEffect(() => { if (suggestions.data) void session.receive(suggestions.data); }, [session, suggestions.data]);
  useEffect(() => { if (suggestions.error) void session.readError(suggestions.error); }, [session, suggestions.error]);
  const format = useQuery({ queryKey: ['procedure-board', procedureId, 'format', state.format?.proposalId],
    queryFn: () => procedureBoardApi.format(procedureId, state.format!.proposalId),
    enabled: !!state.format && !state.forbidden && !['ready', 'stale', 'failed', 'accepted', 'reverted'].includes(state.format.status),
    notifyOnChangeProps: state.busy ? [] : ['data', 'error'],
    retry: false, refetchInterval: query => query.state.data?.pollAfterMs ?? 5000, refetchIntervalInBackground: false });
  useEffect(() => { if (format.data && !state.busy) session.receiveFormat(format.data); }, [format.data, session, state.busy]);
  useEffect(() => { if (format.error) void session.readError(format.error); }, [format.error, session]);
  return { ...state, session };
}

export function formatPreview(layout: BoardLayout, format: FormatProposal | undefined): BoardLayout | undefined {
  if (format?.status !== 'ready' || !format.result) return;
  const items = boardItems(layout).map(entry => entry.item);
  if (format.result.pages.length !== 3 || format.result.pages.some((page, index) => {
    const originals = boardItems({ ...layout, pages: [layout.pages[index]] }).map(entry => entry.item.itemId);
    const ids = page.rows.flatMap(row => row.cols.flatMap(col => col.itemIds));
    return page.page !== index + 1 || ids.length !== originals.length || new Set(ids).size !== ids.length || ids.some(id => !originals.includes(id));
  })) return;
  try {
    return normalizeLayout({ ...layout, pages: format.result.pages.map((page, index) => ({ ...layout.pages[index],
      rows: page.rows.map(row => ({ w: row.w, cols: row.cols.map(col => ({ items: col.itemIds.map(id => {
        const item = items.find(item => item.itemId === id);
        if (!item || !boardItems({ ...layout, pages: [layout.pages[index]] }).some(entry => entry.item.itemId === id)) throw new Error('Invalid format');
        return { ...item, style: format.result!.styles.find(style => style.itemId === id)?.style ?? item.style };
      }) })) })) })) });
  } catch { return; }
}
