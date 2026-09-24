import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const mcpCalls = vi.hoisted(() => [] as unknown[]);

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:os', () => ({ setPriority: () => {} }));
vi.mock('../business-hermes-mcp.service.js', () => ({
  BusinessHermesMcpService: class {
    async call(...args: unknown[]) {
      mcpCalls.push(args);
      return {
        isError: false,
        content: [{
          type: 'text',
          text: JSON.stringify({ results: [{ kind: 'nonconformity', id: 'pg-1', rawText: 'FROM_PG' }] }),
        }],
      };
    }
  },
}));

import { HermesSearchTrialService } from '../hermes-search-trial.service.js';

const FROZEN_ENTRY = '/app/scripts/hermes-search/hermes-qmd-prefetch-worker.mjs';
const V2_ENTRY = '/app/scripts/hermes-search/retrieval/worker.mjs';

function fakeChild(result: Record<string, unknown>) {
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  stdout.setEncoding = () => {};
  const stderr = new EventEmitter() as EventEmitter & { resume: () => void };
  stderr.resume = () => {};
  const stdin = new EventEmitter() as EventEmitter & { write: (line: string) => boolean };
  const child = new EventEmitter() as EventEmitter & {
    stdout: typeof stdout;
    stdin: typeof stdin;
    stderr: typeof stderr;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = stdout;
  child.stdin = stdin;
  child.stderr = stderr;
  child.pid = 42;
  child.kill = vi.fn();
  stdin.write = (line: string) => {
    const request = JSON.parse(String(line).trim()) as { requestId: string };
    setImmediate(() => {
      stdout.emit('data', `__HERMES_UI_PREFETCH__${JSON.stringify({
        workerRequestId: request.requestId,
        stage: 'completed',
        result,
      })}\n`);
    });
    return true;
  };
  setImmediate(() => {
    child.emit('spawn');
    stdout.emit('data', `__HERMES_UI_PREFETCH__${JSON.stringify({
      workerReady: true,
      runtime: { snapshot: { count: 4, snapshotId: 'synthetic' } },
    })}\n`);
  });
  return child;
}

const workerResult = {
  status: 'completed',
  answer: 'WORKER_TEXT',
  recordIds: ['nonconformity:1'],
  elapsedMs: 3,
  searchPlan: { mode: 'exact', args: { query: 'synthetic' } },
};

describe('HermesSearchTrialService retrieval switch', () => {
  const previous = {
    enabled: process.env.HERMES_SEARCH_TRIAL_ENABLED,
    v2: process.env.HERMES_RETRIEVAL_V2_ENABLED,
    source: process.env.HERMES_SEARCH_RECORD_SOURCE,
    entry: process.env.HERMES_SEARCH_ENTRY,
  };

  afterEach(() => {
    process.env.HERMES_SEARCH_TRIAL_ENABLED = previous.enabled;
    if (previous.v2 === undefined) delete process.env.HERMES_RETRIEVAL_V2_ENABLED;
    else process.env.HERMES_RETRIEVAL_V2_ENABLED = previous.v2;
    if (previous.source === undefined) delete process.env.HERMES_SEARCH_RECORD_SOURCE;
    else process.env.HERMES_SEARCH_RECORD_SOURCE = previous.source;
    if (previous.entry === undefined) delete process.env.HERMES_SEARCH_ENTRY;
    else process.env.HERMES_SEARCH_ENTRY = previous.entry;
    spawnMock.mockReset();
    mcpCalls.length = 0;
  });

  it('keeps the frozen entry and the exact handoff when the switch is off', async () => {
    delete process.env.HERMES_RETRIEVAL_V2_ENABLED;
    process.env.HERMES_SEARCH_TRIAL_ENABLED = 'true';
    process.env.HERMES_SEARCH_RECORD_SOURCE = '/tmp/hermes-synthetic-snapshot.json';
    spawnMock.mockImplementation(() => fakeChild(workerResult));
    const service = new HermesSearchTrialService();
    const answer = await service.answer('synthetic question');
    expect(spawnMock.mock.calls[0]?.[1]?.[1]).toBe(FROZEN_ENTRY);
    expect(answer.answer).toBe('FROM_PG');
    expect(answer.recordIds).toEqual(['nonconformity:pg-1']);
    expect(mcpCalls).toHaveLength(1);
    service.close();
  });

  it('spawns the retrieval worker and skips the exact handoff when the switch is on', async () => {
    process.env.HERMES_RETRIEVAL_V2_ENABLED = 'true';
    process.env.HERMES_SEARCH_TRIAL_ENABLED = 'true';
    process.env.HERMES_SEARCH_RECORD_SOURCE = '/tmp/hermes-synthetic-snapshot.json';
    spawnMock.mockImplementation(() => fakeChild({ ...workerResult, dataAsOf: '2026-09-24 09:00' }));
    const service = new HermesSearchTrialService({ loadRecords: async () => [] });
    const answer = await service.answer('synthetic question');
    expect(answer.dataAsOf).toBe('2026-09-24 09:00');
    expect(spawnMock.mock.calls[0]?.[1]?.[1]).toBe(V2_ENTRY);
    expect(spawnMock.mock.calls[0]?.[1]).toContain('--hermes-ui-prefetch-worker');
    expect(answer.answer).toBe('WORKER_TEXT');
    expect(answer.recordIds).toEqual(['nonconformity:1']);
    expect(mcpCalls).toHaveLength(0);
    service.close();
  });

  function v2Settings(overrides: Partial<{ maxInflight: number; maxQueue: number; queueWaitMs: number; refreshSec: number; loadRecords: () => Promise<Array<Record<string, unknown>>> }> = {}) {
    return {
      enabled: true,
      node: process.execPath,
      entry: V2_ENTRY,
      recordSource: '/tmp/hermes-synthetic-snapshot.json',
      retrievalV2: true,
      maxInflight: overrides.maxInflight ?? 4,
      maxQueue: overrides.maxQueue ?? 8,
      queueWaitMs: overrides.queueWaitMs ?? 3000,
      refreshSec: overrides.refreshSec ?? 300,
      loadRecords: overrides.loadRecords ?? (async () => []),
    };
  }

  function holdingChild() {
    const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
    stdout.setEncoding = () => {};
    const stderr = new EventEmitter() as EventEmitter & { resume: () => void };
    stderr.resume = () => {};
    const held: Array<{ request: { requestId: string; question?: string; session?: { previousPlan?: { semanticQuery?: string } } }; release: (result: Record<string, unknown>) => void }> = [];
    const corpus: Array<{ mode?: string; records?: unknown[]; asOf?: string }> = [];
    const stdin = new EventEmitter() as EventEmitter & { write: (line: string) => boolean };
    const child = new EventEmitter() as EventEmitter & { stdout: typeof stdout; stdin: typeof stdin; stderr: typeof stderr; pid: number; kill: ReturnType<typeof vi.fn> };
    child.stdout = stdout;
    child.stdin = stdin;
    child.stderr = stderr;
    child.pid = 42;
    child.kill = vi.fn();
    stdin.write = (line: string) => {
      const request = JSON.parse(String(line).trim()) as { type?: string; mode?: string; records?: unknown[]; asOf?: string; requestId: string; question?: string; session?: { previousPlan?: { semanticQuery?: string } } };
      if (request.type === 'corpus') {
        corpus.push(request);
        return true;
      }
      held.push({
        request,
        release: (result) => stdout.emit('data', `__HERMES_UI_PREFETCH__${JSON.stringify({
          workerRequestId: request.requestId,
          stage: 'completed',
          result,
        })}\n`),
      });
      return true;
    };
    setImmediate(() => {
      child.emit('spawn');
      stdout.emit('data', `__HERMES_UI_PREFETCH__${JSON.stringify({
        workerReady: true,
        runtime: { snapshot: { count: 4, snapshotId: 'synthetic' } },
      })}\n`);
    });
    return { child, held, corpus };
  }

  it('runs four retrieval requests and queues the next two', async () => {
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const service = new HermesSearchTrialService(v2Settings());
    const answers = Array.from({ length: 6 }, (_, index) => service.answer(`q${index}`, `00000000-0000-4000-8000-00000000000${index}`));
    await vi.waitFor(() => expect(gate.held).toHaveLength(4));
    expect(gate.held).toHaveLength(4);
    gate.held.splice(0, 2).forEach((item) => item.release({ status: 'completed', answer: 'A', recordIds: [], elapsedMs: 1, session: { pending: null, searchRequest: null, searchState: null, jevDialogue: [], previousPlan: { semanticQuery: 'a' } } }));
    await vi.waitFor(() => expect(gate.held).toHaveLength(4));
    gate.held.splice(0).forEach((item) => item.release({ status: 'completed', answer: 'B', recordIds: [], elapsedMs: 1, session: { pending: null, searchRequest: null, searchState: null, jevDialogue: [], previousPlan: { semanticQuery: 'b' } } }));
    const results = await Promise.all(answers);
    expect(results).toHaveLength(6);
    expect(results.every((item) => item.status === 'completed')).toBe(true);
    service.close();
  });

  it('returns the busy message when the retrieval queue is full', async () => {
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const service = new HermesSearchTrialService(v2Settings({ maxInflight: 1, maxQueue: 1, queueWaitMs: 2000 }));
    const first = service.answer('first');
    await vi.waitFor(() => expect(gate.held).toHaveLength(1));
    const queued = service.answer('queued');
    const overflow = await service.answer('overflow');
    expect(overflow).toMatchObject({
      status: 'unavailable',
      answer: '検索が混み合っています。少し待ってからもう一度送信してください。',
      recordIds: [],
    });
    expect(gate.held).toHaveLength(1);
    gate.held[0].release({ status: 'completed', answer: 'done', recordIds: [], elapsedMs: 1, session: { pending: null, searchRequest: null, searchState: null, jevDialogue: [], previousPlan: null } });
    await vi.waitFor(() => expect(gate.held).toHaveLength(2));
    gate.held[1].release({ status: 'completed', answer: 'next', recordIds: [], elapsedMs: 1, session: { pending: null, searchRequest: null, searchState: null, jevDialogue: [], previousPlan: null } });
    await expect(first).resolves.toMatchObject({ answer: 'done' });
    await expect(queued).resolves.toMatchObject({ answer: 'next' });
    service.close();
  });

  it('keeps previous plans separated across interleaved sessions', async () => {
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const service = new HermesSearchTrialService(v2Settings({ maxInflight: 2 }));
    const sessionA = '00000000-0000-4000-8000-0000000000a1';
    const sessionB = '00000000-0000-4000-8000-0000000000b1';
    const firstA = service.answer('alpha', sessionA);
    const firstB = service.answer('beta', sessionB);
    await vi.waitFor(() => expect(gate.held).toHaveLength(2));
    const plan = (semanticQuery: string) => ({ pending: null, searchRequest: null, searchState: null, jevDialogue: [], previousPlan: { semanticQuery, filters: [], sources: ['nonconformity'], sort: 'relevance', limit: 1 } });
    gate.held.splice(0).forEach((item) => item.release({
      status: 'completed',
      answer: 'first',
      recordIds: [],
      elapsedMs: 1,
      session: plan(item.request.question ?? ''),
    }));
    await Promise.all([firstA, firstB]);
    const followA = service.answer('again-a', sessionA);
    const followB = service.answer('again-b', sessionB);
    await vi.waitFor(() => expect(gate.held).toHaveLength(2));
    const queries = gate.held.map((item) => item.request.session?.previousPlan?.semanticQuery);
    expect(queries).toEqual(['alpha', 'beta']);
    gate.held.splice(0).forEach((item) => item.release({ status: 'completed', answer: 'follow', recordIds: [], elapsedMs: 1, session: plan(item.request.session?.previousPlan?.semanticQuery ?? '') }));
    await Promise.all([followA, followB]);
    service.close();
  });

  it('sends an initial corpus and then an incremental merge without dropping the previous load', async () => {
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const loads = [
      [{ id: 'a', kind: 'nonconformity', condition: 'alpha mark' }],
      [
        { id: 'a', kind: 'nonconformity', condition: 'alpha revised' },
        { id: 'b', kind: 'nonconformity', condition: 'beta mark' },
      ],
    ];
    let calls = 0;
    const service = new HermesSearchTrialService(v2Settings({
      refreshSec: 1,
      loadRecords: async () => {
        const page = loads[Math.min(calls, loads.length - 1)];
        calls += 1;
        if (calls === 3) throw new Error('synthetic refresh failure');
        return page;
      },
    }));
    await service.scope();
    await vi.waitFor(() => expect(gate.corpus).toHaveLength(1));
    expect(gate.corpus[0]?.mode).toBe('full');
    expect(gate.corpus[0]?.records).toHaveLength(1);
    await vi.waitFor(() => expect(gate.corpus).toHaveLength(2), { timeout: 2500 });
    expect(gate.corpus[1]?.mode).toBe('incremental');
    expect(gate.corpus[1]?.records).toHaveLength(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 2500 });
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('count=2');
    expect(gate.corpus).toHaveLength(2);
    warn.mockRestore();
    service.close();
  });
});
