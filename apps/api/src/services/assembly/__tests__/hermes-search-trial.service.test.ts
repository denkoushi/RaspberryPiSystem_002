import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeProcedureDocument } from '@raspi-system/shared-types';

const spawnMock = vi.hoisted(() => vi.fn());
const mcpCalls = vi.hoisted(() => [] as unknown[]);
const readSourcePage = vi.hoisted(() => vi.fn());
const trainingReaderFactory = vi.hoisted(() => vi.fn());
vi.mock('../../torque-training/torque-training-hermes-source.service.js', () => ({
  createTorqueTrainingSourceReaders: trainingReaderFactory,
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:os', () => ({ setPriority: () => {} }));
vi.mock('../business-hermes-mcp.service.js', () => ({
  BusinessHermesMcpService: class {
    readSourcePage = readSourcePage;
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
import type { KnowledgeProcedureRepositoryPort } from '../../knowledge/knowledge-procedure.port.js';

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
    sources: process.env.HERMES_RETRIEVAL_SOURCES,
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
    readSourcePage.mockReset();
    trainingReaderFactory.mockReset();
    if (previous.sources === undefined) delete process.env.HERMES_RETRIEVAL_SOURCES;
    else process.env.HERMES_RETRIEVAL_SOURCES = previous.sources;
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

  function holdingChild(memory?: Record<string, unknown>) {
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
        runtime: { snapshot: { count: 4, snapshotId: 'synthetic' }, ...(memory ? { memory } : {}) },
      })}\n`);
    });
    return { child, held, corpus };
  }

  function procedureRepository() {
    const published: KnowledgeProcedureDocument = {
      formatVersion: 1, procedureId: 'p1', revisionId: 'r1', revisionNumber: 1,
      title: 'ブラケット溶接', category: '組立', identifiers: {}, reviewTier: 'auto_publish', state: 'published',
      createdAt: '2026-09-01T00:00:00Z', steps: [{ id: 's1', title: '準備', body: '固定する', cautions: [], needsReview: [], photos: [], sources: [{ kind: 'note', ref: 'n1', label: '原資料' }] }],
    };
    const summary = { procedureId: 'p1', title: published.title, category: published.category, identifiers: {}, reviewTier: published.reviewTier, revisionNumber: 1, publishedAt: '2026-10-03T15:00:00Z' };
    const repository = {
      createDraft: vi.fn(), publishAutomatic: vi.fn(), listTopics: vi.fn(), searchTopics: vi.fn(),
      claimBuild: vi.fn(), completeBuild: vi.fn(), failBuild: vi.fn(),
      listPublished: vi.fn().mockResolvedValue([summary, { ...summary, procedureId: 'removed' }, { ...summary, procedureId: 'draft' }, { ...summary, procedureId: 'changed' }]),
      getPublished: vi.fn(async (id: string): Promise<KnowledgeProcedureDocument | null> => id === 'p1' ? published : id === 'draft' ? { ...published, state: 'draft' } : id === 'changed' ? { ...published, revisionNumber: 2 } : null),
    } satisfies KnowledgeProcedureRepositoryPort;
    return repository;
  }

  it('reads both authorized sources, pages nonconformities and replaces removed publications', async () => {
    process.env.HERMES_RETRIEVAL_SOURCES = 'nonconformity,knowledge_procedure';
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    readSourcePage.mockImplementation(async (_kind: string, offset: number) => ({
      content: [{ type: 'text', text: JSON.stringify({
        results: offset === 0 ? [{ kind: 'nonconformity', id: 'n1', condition: '溶接不適合' }, { kind: 'work_instruction', id: 'skip' }] : [{ kind: 'nonconformity', id: 'n2' }],
        hasMore: { nonconformity: offset === 0 }, nextCursor: { nonconformityOffset: offset === 0 ? 200 : null },
      }) }],
    }));
    const procedures = procedureRepository();
    const service = new HermesSearchTrialService({ ...v2Settings(), loadRecords: undefined, procedures, refreshSec: 1 });
    try {
      await service.scope();
      await vi.waitFor(() => expect(gate.corpus).toHaveLength(1));
      expect(readSourcePage.mock.calls.slice(0, 2)).toEqual([['nonconformity', 0], ['nonconformity', 200]]);
      expect(gate.corpus[0]?.records).toEqual([
        { kind: 'nonconformity', id: 'n1', condition: '溶接不適合' }, { kind: 'nonconformity', id: 'n2' },
        { kind: 'knowledge_procedure', id: 'p1', title: 'ブラケット溶接', category: '組立', partNumber: '', drawingNumber: '', processName: '', publishedOn: '2026-10-04', stepsText: '1. 準備\n固定する', cautionsText: '' },
      ]);
      expect(procedures.getPublished.mock.calls).toEqual([['p1'], ['removed'], ['draft'], ['changed']]);
      procedures.listPublished.mockResolvedValue([]);
      await vi.waitFor(() => expect(gate.corpus).toHaveLength(2), { timeout: 2500 });
      expect(gate.corpus[1]?.mode).toBe('full');
      expect(gate.corpus[1]?.records).toHaveLength(2);
    } finally { service.close(); }
  });

  it('registers only opted-in training readers and shares the reader factory per corpus refresh', async () => {
    process.env.HERMES_RETRIEVAL_SOURCES = 'torque_training_session,torque_training_operator,torque_training_team';
    const ids = process.env.HERMES_RETRIEVAL_SOURCES.split(',');
    const readers = Object.fromEntries(ids.map(id => [id, vi.fn().mockResolvedValue([{ kind: id, id: 'synthetic' }])]));
    trainingReaderFactory.mockReturnValue(readers);
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const service = new HermesSearchTrialService({ ...v2Settings(), loadRecords: undefined });
    try {
      await service.scope();
      await vi.waitFor(() => expect(gate.corpus).toHaveLength(1));
      expect(gate.corpus[0]?.records).toEqual(ids.map(id => ({ kind: id, id: 'synthetic' })));
      expect(trainingReaderFactory).toHaveBeenCalledTimes(1);
      for (const reader of Object.values(readers)) expect(reader).toHaveBeenCalledTimes(1);
      expect(readSourcePage).not.toHaveBeenCalled();
    } finally { service.close(); }
  });

  it('keeps the default authorized reader on nonconformity without reading procedures', async () => {
    delete process.env.HERMES_RETRIEVAL_SOURCES;
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    readSourcePage.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ results: [{ kind: 'nonconformity', id: 'n1' }] }) }] });
    const procedures = procedureRepository();
    const service = new HermesSearchTrialService({ ...v2Settings(), loadRecords: undefined, procedures });
    try {
      await service.scope();
      await vi.waitFor(() => expect(gate.corpus).toHaveLength(1));
      expect(gate.corpus[0]?.records).toEqual([{ kind: 'nonconformity', id: 'n1' }]);
      expect(procedures.listPublished).not.toHaveBeenCalled();
      expect(trainingReaderFactory).not.toHaveBeenCalled();
    } finally { service.close(); }
  });

  it('rejects unknown sources before spawning with the error used by the existing 503 route', async () => {
    process.env.HERMES_RETRIEVAL_SOURCES = 'nonconformity,missing';
    const service = new HermesSearchTrialService(v2Settings());
    await expect(service.scope()).rejects.toThrow('unknown retrieval source: missing');
    await expect(service.answer('溶接手順書')).rejects.toThrow('unknown retrieval source: missing');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('keeps procedure rows out of both nonconformity night jobs', async () => {
    const previous = { enrichment: process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED, flywheel: process.env.HERMES_FLYWHEEL_ENABLED };
    const gate = holdingChild();
    const written: Array<{ records: unknown[] }> = [];
    const rows = [
      { kind: 'nonconformity', id: 'n1', condition: 'mark' },
      { kind: 'knowledge_procedure', id: 'p1', stepsText: 'procedure' },
      { sourceId: 'knowledge_procedure', id: 'p2', stepsText: 'converted procedure' },
      { id: 'legacy', condition: 'legacy record' },
    ];
    spawnMock.mockImplementation((_node: string, args: string[]) => {
      if (args.includes('--hermes-ui-prefetch-worker')) return gate.child;
      const stdin = new EventEmitter() as EventEmitter & { write: (line: string) => boolean; end: () => void };
      stdin.write = (line: string) => { written.push(JSON.parse(line)); return true; };
      stdin.end = vi.fn();
      return Object.assign(new EventEmitter(), { stdin, pid: 43, kill: vi.fn() });
    });
    process.env.HERMES_RETRIEVAL_SOURCES = 'nonconformity,knowledge_procedure';
    process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED = 'true';
    process.env.HERMES_FLYWHEEL_ENABLED = 'true';
    const service = new HermesSearchTrialService(v2Settings({ loadRecords: async () => rows }));
    try {
      await service.scope();
      await vi.waitFor(() => expect(written).toHaveLength(2));
      expect(written.map(input => input.records)).toEqual([[rows[0], rows[3]], [rows[0], rows[3]]]);
    } finally {
      service.close();
      if (previous.enrichment === undefined) delete process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED;
      else process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED = previous.enrichment;
      if (previous.flywheel === undefined) delete process.env.HERMES_FLYWHEEL_ENABLED;
      else process.env.HERMES_FLYWHEEL_ENABLED = previous.flywheel;
    }
  });


  it('forwards pageContext per request without storing it in the session', async () => {
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const service = new HermesSearchTrialService(v2Settings());
    const pageContext = { path: '/kiosk/part-measurement/self-inspection', entity: { kind: 'partNumber' as const, value: 'FH001' } };
    const receipt = { pageContext: { used: true, ...pageContext.entity } };
    try {
      const first = service.answer('この品番の不適合', 'session-a', pageContext);
      await vi.waitFor(() => expect(gate.held).toHaveLength(1));
      expect(gate.held[0].request).toMatchObject({ type: 'request', question: 'この品番の不適合', pageContext });
      gate.held[0].release({ ...workerResult, receipt, session: { previousPlan: { filters: [] } } });
      await expect(first).resolves.toMatchObject({ receipt });
      const second = service.answer('最近の不適合', 'session-a');
      await vi.waitFor(() => expect(gate.held).toHaveLength(2));
      expect(gate.held[1].request).not.toHaveProperty('pageContext');
      expect(gate.held[1].request.session).not.toHaveProperty('pageContext');
      gate.held[1].release(workerResult);
      await second;
    } finally { service.close(); }
  });

  it('forwards principal alongside pageContext without changing calls that omit either', async () => {
    const gate = holdingChild();
    spawnMock.mockImplementation(() => gate.child);
    const service = new HermesSearchTrialService(v2Settings());
    const pageContext = { path: '/page', entity: { kind: 'partNumber' as const, value: 'P' } };
    try {
      const first = service.answer('q', 'session-a', pageContext, { principal: { kind: 'viewer' } });
      await vi.waitFor(() => expect(gate.held).toHaveLength(1));
      expect(gate.held[0].request).toMatchObject({ pageContext, principal: { kind: 'viewer' } });
      gate.held[0].release({ ...workerResult, session: { previousPlan: { sources: ['nonconformity'] } } });
      await first;
      const second = service.answer('q', 'session-a', undefined, { principal: { kind: 'admin' } });
      await vi.waitFor(() => expect(gate.held).toHaveLength(2));
      expect(gate.held[1].request).toMatchObject({ principal: { kind: 'admin' } });
      expect(gate.held[1].request).not.toHaveProperty('pageContext');
      expect(gate.held[1].request.session).not.toHaveProperty('principal');
      gate.held[1].release(workerResult);
      await second;
      const legacy = service.answer('q');
      await vi.waitFor(() => expect(gate.held).toHaveLength(3));
      expect(gate.held[2].request).not.toHaveProperty('principal');
      expect(gate.held[2].request).not.toHaveProperty('pageContext');
      gate.held[2].release(workerResult);
      await legacy;
    } finally { service.close(); }
  });

  it('stores ready and corpus memory in scope and logs one numeric line per report', async () => {
    const memory = { heapUsedMb: 12.3, rssMb: 56.8, externalMb: 9.9, arrayBuffersMb: 3.2,
      records: 4, bySource: { nonconformity: 4, knowledge_procedure: 0 } };
    const gate = holdingChild({ ...memory, body: 'PRIVATE_RECORD_TEXT' });
    spawnMock.mockImplementation(() => gate.child);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const service = new HermesSearchTrialService(v2Settings());
    const emit = (row: Record<string, unknown>) => gate.child.stdout.emit('data', `__HERMES_UI_PREFETCH__${JSON.stringify(row)}\n`);
    try {
      expect(await service.scope()).toMatchObject({ snapshotCount: 4, snapshotId: 'synthetic', memory });
      expect((await service.scope()).memory).not.toHaveProperty('body');
      const updated = { ...memory, heapUsedMb: 23.4, records: 5, bySource: { nonconformity: 4, knowledge_procedure: 1 } };
      emit({ type: 'corpus', ok: true, count: 5, memory: updated });
      expect(await service.scope()).toMatchObject({ snapshotId: 'synthetic', memory: updated });
      const pending = service.answer('PRIVATE_QUESTION');
      await vi.waitFor(() => expect(gate.held).toHaveLength(1));
      emit({ type: 'corpus', ok: false, count: 5, memory: updated });
      gate.held[0].release(workerResult);
      await expect(pending).resolves.toMatchObject({ answer: 'WORKER_TEXT' });
      expect(info).toHaveBeenCalledTimes(3);
      expect(info.mock.calls[0]).toEqual(['hermes retrieval memory heapUsedMb=12.3 rssMb=56.8 externalMb=9.9 arrayBuffersMb=3.2 records=4 bySource={"nonconformity":4,"knowledge_procedure":0}']);
      expect(info.mock.calls.every(call => call.length === 1 && !String(call[0]).includes('\n'))).toBe(true);
      expect(JSON.stringify(info.mock.calls)).not.toMatch(/PRIVATE|WORKER_TEXT/);
    } finally { service.close(); info.mockRestore(); }
  });

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

  it('starts the retrieval worker at API start only while enrichment is on', async () => {
    const previousEnrichment = process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED;
    try {
      const gate = holdingChild();
      spawnMock.mockImplementation(() => gate.child);
      delete process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED;
      const idle = new HermesSearchTrialService(v2Settings());
      idle.warmForEnrichment();
      expect(spawnMock).not.toHaveBeenCalled();
      idle.close();
      process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED = 'true';
      const service = new HermesSearchTrialService(v2Settings());
      service.warmForEnrichment();
      expect(spawnMock.mock.calls[0]?.[1]?.[1]).toBe(V2_ENTRY);
      await vi.waitFor(() => expect(gate.corpus).toHaveLength(1));
      service.close();
    } finally {
      if (previousEnrichment === undefined) delete process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED;
      else process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED = previousEnrichment;
    }
  });

  it('starts the flywheel runner with the corpus only while the flywheel is on', async () => {
    const previous = { flywheel: process.env.HERMES_FLYWHEEL_ENABLED, enrichment: process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED };
    try {
      const gate = holdingChild();
      const written: string[] = [];
      const runnerStdin = new EventEmitter() as EventEmitter & { write: (line: string) => boolean; end: () => void };
      runnerStdin.write = (line: string) => { written.push(String(line)); return true; };
      runnerStdin.end = vi.fn();
      const runner = new EventEmitter() as EventEmitter & { stdin: typeof runnerStdin; pid: number; kill: ReturnType<typeof vi.fn> };
      runner.stdin = runnerStdin;
      runner.pid = 43;
      runner.kill = vi.fn();
      spawnMock.mockImplementation((_node: string, args: string[]) => (String(args[0]).endsWith('flywheel-runner.mjs') ? runner : gate.child));
      delete process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED;
      process.env.HERMES_FLYWHEEL_ENABLED = 'true';
      // The runner is started only with a non-empty corpus.
      const service = new HermesSearchTrialService(v2Settings({ loadRecords: async () => [{ id: 'rec-1', condition: 'scratch' }] }));
      service.warmForEnrichment();
      await vi.waitFor(() => expect(gate.corpus).toHaveLength(1));
      await vi.waitFor(() => expect(written).toHaveLength(1));
      const runnerCall = spawnMock.mock.calls.find((call) => String(call[1]?.[0]).endsWith('flywheel-runner.mjs'));
      expect(runnerCall?.[1]?.[0]).toBe('/app/scripts/hermes-search/retrieval/flywheel-runner.mjs');
      expect(Array.isArray(JSON.parse(written[0] ?? '{}').records)).toBe(true);
      expect(runnerStdin.end).toHaveBeenCalled();
      service.close();
      expect(runner.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      if (previous.flywheel === undefined) delete process.env.HERMES_FLYWHEEL_ENABLED;
      else process.env.HERMES_FLYWHEEL_ENABLED = previous.flywheel;
      if (previous.enrichment === undefined) delete process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED;
      else process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED = previous.enrichment;
    }
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
