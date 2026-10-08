import { spawn, type ChildProcessByStdio, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {setPriority} from 'node:os';
import { loadProcedureMaterialRecords } from './procedure-material-hermes-source.service.js';
import { BusinessHermesMcpService } from './business-hermes-mcp.service.js';
import { createTorqueTrainingSourceReaders } from '../torque-training/torque-training-hermes-source.service.js';
import type { KnowledgeProcedureRepositoryPort } from '../knowledge/knowledge-procedure.port.js';
import { knowledgeProcedureRow, registeredSourceReaders, retrievalSourceIdsFromEnv, type RetrievalSourceId } from './hermes-search-sources.js';

export type HermesPageContext = {
  path: string;
  entity: { kind: 'partNumber' | 'drawingNumber' | 'nonconformityNo' | 'procedureId'; value: string };
};

export type HermesPrincipal = { kind: 'kiosk' | 'viewer' | 'manager' | 'admin' };
type HermesAnswerOptions = { principal?: HermesPrincipal };
type WorkerMemory = {
  heapUsedMb: number;
  rssMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  records: number;
  bySource: Record<string, number>;
};

type SearchState = Record<string, unknown>;
type SearchDiagnostics = {
  before: string;
  after: string;
  delta: string;
  state: Record<string, unknown>;
  resultCount: number;
  source?: string;
  classificationCoverage?: Record<string, unknown>;
  conditionChange?: Record<string, unknown>;
  operationDecision?: Record<string, unknown>;
};
type SearchPlan = { mode: 'exact' | 'classified'; source?: string; args?: Record<string, unknown> };

export type HermesTrialAnswer = {
  status: string;
  answer: string;
  recordIds: string[];
  elapsedMs: number;
  confirmationPending?: {
    request: string;
    question: string;
    purpose: string | null;
    requiredItems: Array<{id: string; label: string; type: string; candidates: unknown[]}>;
    confirmedInfo: Record<string, unknown>;
    unresolvedItems: string[];
  } | null;
  searchState?: SearchState;
  searchDelta?: { action: string; digest: string; applied: boolean };
  searchPlan?: SearchPlan;
  searchDiagnostics?: SearchDiagnostics;
  dataAsOf?: string | null;
  /** Planner decisions and outcome for the API log. Routes remove it before replying. */
  receipt?: Record<string, unknown>;
};

type TrialSession = {
  pending: unknown | null;
  searchRequest: null;
  searchState: SearchState | null;
  jevDialogue: Array<{role: 'assistant'; content: string}>;
  expiresAt: number;
};

export type HermesRankResult = { recordIds: string[]; mode: 'semantic' | 'lexical'; fallback: boolean };
export type HermesRankAvailability = { available: true; mode: 'semantic' | 'lexical'; recordIds: string[] }
  | { available: false; mode: 'unavailable'; recordIds: string[] };
type PendingWorkerRequest =
  | { kind?: 'answer'; resolve: (value: HermesTrialAnswer) => void; reject: (error: Error) => void }
  | { kind: 'rank'; resolve: (value: HermesRankResult) => void; reject: (error: Error) => void };

function isRankResult(value: unknown): value is HermesRankResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as HermesRankResult;
  return Array.isArray(result.recordIds) && result.recordIds.every(id => typeof id === 'string')
    && (result.mode === 'semantic' || result.mode === 'lexical') && result.fallback === (result.mode === 'lexical');
}

type WorkerResponse = { type?: string; ok?: boolean; sourceIds?: RetrievalSourceId[]; workerReady?: boolean; workerRequestId?: string; workerError?: string; failureDiagnostic?: unknown; memory?: WorkerMemory; runtime?: {
  snapshot?: { count: number; snapshotId: string }; organized?: { count: number };
  memory?: WorkerMemory;
}; result?: HermesTrialAnswer | HermesRankResult };

type TrialSettings = {
  enabled: boolean;
  node: string;
  entry: string;
  recordSource: string | null;
  retrievalV2: boolean;
  maxInflight: number;
  maxQueue: number;
  queueWaitMs: number;
  refreshSec: number;
  loadRecords?: () => Promise<Array<Record<string, unknown>>>;
  procedures?: KnowledgeProcedureRepositoryPort;
  createTrainingReaders?: typeof createTorqueTrainingSourceReaders;
};

const BUSY_ANSWER = '検索が混み合っています。少し待ってからもう一度送信してください。';

function positiveInt(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function trialSettingsFromEnv(): TrialSettings {
  const retrievalV2 = process.env.HERMES_RETRIEVAL_V2_ENABLED === 'true';
  return {
    enabled: process.env.HERMES_SEARCH_TRIAL_ENABLED === 'true',
    node: process.env.HERMES_SEARCH_NODE ?? '/opt/hermes-node/bin/node',
    entry: retrievalV2
      ? (process.env.HERMES_RETRIEVAL_V2_ENTRY ?? '/app/scripts/hermes-search/retrieval/worker.mjs')
      : (process.env.HERMES_SEARCH_ENTRY ?? '/app/scripts/hermes-search/hermes-qmd-prefetch-worker.mjs'),
    recordSource: process.env.HERMES_SEARCH_RECORD_SOURCE ?? process.env.HERMES_TRIAL_SNAPSHOT_PATH ?? null,
    retrievalV2,
    maxInflight: positiveInt(process.env.HERMES_RETRIEVAL_V2_MAX_INFLIGHT, 4),
    maxQueue: positiveInt(process.env.HERMES_RETRIEVAL_V2_MAX_QUEUE, 8),
    queueWaitMs: 3000,
    refreshSec: positiveInt(process.env.HERMES_RETRIEVAL_V2_REFRESH_SEC, 300),
  };
}

export class HermesSearchTrialService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: { id: string; resolve: (value: HermesTrialAnswer) => void; reject: (error: Error) => void } | null = null;
  private readonly pendingMap = new Map<string, PendingWorkerRequest>();
  private inflight = 0;
  private waitQueue: Array<{ grant: () => void; reject: (error: Error) => void }> = [];
  private runtime: WorkerResponse['runtime'];
  private ready: Promise<void> | null = null;
  private failure: Error | null = null;
  private readonly sessions = new Map<string, TrialSession>();
  private sourceSearch: BusinessHermesMcpService | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private corpusReady = false;
  private readonly appliedCorpusSources = new Set<RetrievalSourceId>();
  private retrievalSources: RetrievalSourceId[] = ['nonconformity'];
  private procedures: KnowledgeProcedureRepositoryPort | null = null;
  private lastCorpusCount = 0;
  private enrichmentChild: ChildProcessByStdio<Writable, null, null> | null = null;
  private flywheelChild: ChildProcessByStdio<Writable, null, null> | null = null;

  private readonly settings: TrialSettings;

  constructor(overrides: Partial<TrialSettings> = {}) {
    this.settings = { ...trialSettingsFromEnv(), ...overrides };
  }

  isEnabled() { return this.settings.enabled; }

  // Enrichment and the synthetic question flywheel run from the corpus refresh, which starts with
  // the worker. Without this, an API restart leaves the night jobs idle until the first Chat request.
  warmForEnrichment() {
    if (!this.settings.enabled || !this.settings.retrievalV2) return;
    if (process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED !== 'true' && process.env.HERMES_FLYWHEEL_ENABLED !== 'true') return;
    this.start().catch(() => { console.warn('hermes retrieval warm start failed'); });
  }

  private start(): Promise<void> {
    if (!this.settings.enabled) return Promise.reject(new Error('JEV記録検索は無効です。'));
    if (this.failure) return Promise.reject(this.failure);
    if (this.ready) return this.ready;
    if (this.settings.retrievalV2) {
      try { this.retrievalSources = retrievalSourceIdsFromEnv(process.env); }
      catch (error) { return Promise.reject(error); }
    }
    if ((!process.env.HERMES_INFERENCE_ORIGIN || !process.env.HERMES_INFERENCE_TOKEN) && !this.settings.recordSource) {
      return Promise.reject(new Error('JEV記録検索の接続設定がありません。'));
    }
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(this.settings.node, ['--max-old-space-size=384', this.settings.entry, '--hermes-ui-prefetch-worker'], {
        env: { ...process.env, HERMES_ALLOW_INDEX_UPDATE: 'false', UV_THREADPOOL_SIZE:'2' }, stdio: ['pipe','pipe','pipe']
      });
      child.once('spawn',()=>{if(child.pid)try{setPriority(child.pid,10);}catch{/* OS scheduling may already constrain this container. */}});
      this.child = child;
      let buffer = '';
      const fail = () => {
        const error = new Error('JEV記録検索を利用できません。検索失敗のため、該当なしとは判断していません。');
        if (this.settings.retrievalV2) {
          for (const pending of this.pendingMap.values()) pending.reject(error);
          this.pendingMap.clear();
          for (const waiter of this.waitQueue) waiter.reject(error);
          this.waitQueue = [];
          this.inflight = 0;
          this.appliedCorpusSources.clear();
          this.child = null;
          this.ready = null;
          this.failure = null;
        } else {
          this.failure = error;
          this.pending?.reject(error);
          this.pending = null;
        }
        reject(error);
      };
      const timeout = setTimeout(() => { fail(); child.kill('SIGTERM'); }, 30000);
      child.once('error', () => { clearTimeout(timeout); fail(); });
      child.stdin.on('error', () => { clearTimeout(timeout); fail(); child.kill('SIGTERM'); });
      child.once('exit', () => { clearTimeout(timeout); fail(); this.child = null; });
      // Diagnostic bodies can include source text. The API never logs them.
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > 8 * 1024 * 1024) { fail(); child.kill('SIGTERM'); return; }
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('__HERMES_UI_PREFETCH__')) continue;
          try {
            const row = JSON.parse(line.slice('__HERMES_UI_PREFETCH__'.length)) as WorkerResponse;
            if (row.type === 'corpus' && row.ok === true && Array.isArray(row.sourceIds)) {
              for (const sourceId of row.sourceIds) if (this.retrievalSources.includes(sourceId)) this.appliedCorpusSources.add(sourceId);
            }
            if (row.workerReady) this.runtime = row.runtime;
            if (row.memory || row.runtime?.memory) {
              const memory = (row.memory ?? row.runtime?.memory)!;
              if (![memory.heapUsedMb, memory.rssMb, memory.externalMb, memory.arrayBuffersMb, memory.records]
                .every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error('invalid worker memory');
              // Pick only numeric telemetry: worker diagnostics and record text never enter this log.
              const bySource = Object.fromEntries(Object.entries(memory.bySource).filter(([, count]) => typeof count === 'number' && Number.isFinite(count)));
              this.runtime = { ...this.runtime, memory: {
                heapUsedMb: memory.heapUsedMb, rssMb: memory.rssMb, externalMb: memory.externalMb,
                arrayBuffersMb: memory.arrayBuffersMb, records: memory.records, bySource,
              } };
              console.info(`hermes retrieval memory heapUsedMb=${memory.heapUsedMb} rssMb=${memory.rssMb} externalMb=${memory.externalMb} arrayBuffersMb=${memory.arrayBuffersMb} records=${memory.records} bySource=${JSON.stringify(bySource)}`);
            }
            if (row.workerReady) {
              clearTimeout(timeout);
              resolve();
              if (this.settings.retrievalV2) this.scheduleRefresh();
            }
            else if (this.settings.retrievalV2 && row.workerRequestId && this.pendingMap.has(row.workerRequestId)) {
              const pending = this.pendingMap.get(row.workerRequestId);
              this.pendingMap.delete(row.workerRequestId);
              this.releaseSlot();
              if (!pending) continue;
              if (row.workerError || !row.result || (pending.kind === 'rank' ? !isRankResult(row.result) : !('answer' in row.result) || typeof row.result.answer !== 'string')) {
                const error = new Error('検索に失敗しました。該当なしとは判断していません。') as Error & { workerFailureDiagnostic?: unknown };
                if (row.failureDiagnostic !== undefined) error.workerFailureDiagnostic = row.failureDiagnostic;
                pending.reject(error);
              } else if (pending.kind === 'rank') pending.resolve(row.result as HermesRankResult);
              else pending.resolve(row.result as HermesTrialAnswer);
            }
            else if (row.workerRequestId === this.pending?.id) {
              const pending = this.pending;
              this.pending = null;
              if (row.workerError || !row.result || !('answer' in row.result) || typeof row.result.answer !== 'string') {
                const error = new Error('検索に失敗しました。該当なしとは判断していません。') as Error & { workerFailureDiagnostic?: unknown };
                if (row.failureDiagnostic !== undefined) error.workerFailureDiagnostic = row.failureDiagnostic;
                pending?.reject(error);
              }
              else pending?.resolve(row.result as HermesTrialAnswer);
            } else if (row.workerError) { clearTimeout(timeout); fail(); }
          } catch { fail(); child.kill('SIGTERM'); }
        }
      });
    });
    return this.ready;
  }

  async scope() {
    if (!this.settings.enabled) return { enabled: false };
    await this.start();
    return { enabled: true, snapshotCount: this.runtime?.snapshot?.count,
      organizedCount: this.runtime?.organized?.count, snapshotId: this.runtime?.snapshot?.snapshotId,
      memory: this.runtime?.memory };
  }

  async answer(question: string, sessionId?: string, pageContext?: HermesPageContext, options: HermesAnswerOptions = {}): Promise<HermesTrialAnswer> {
    if (this.settings.retrievalV2) return this.answerRetrievalV2(question, sessionId, pageContext, options);
    await this.start();
    if (this.pending) throw new Error('別の検索を処理中です。少し待って再送してください。');
    const activeSessionId = sessionId ?? randomUUID();
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    const stored = this.sessions.get(activeSessionId);
    const session = stored && stored.expiresAt > now ? stored : { pending: null, searchRequest: null, searchState: null, jevDialogue: [], expiresAt: now };
    const result = await new Promise<HermesTrialAnswer>((resolve, reject) => {
      const id = randomUUID();
      const timeout = setTimeout(() => {
        // Keep worker ownership until it actually completes; do not start overlapping work.
        reject(new Error('検索の待ち時間を超えました。該当なしとは判断していません。'));
      }, 30000);
      this.pending = { id, resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } };
      this.child!.stdin.write(JSON.stringify({ type:'request', requestId:id, question, session, ...(options.principal ? { principal: options.principal } : {}) })+'\n');
    });
    const workerSession = (result as HermesTrialAnswer & {session?: Omit<TrialSession, 'expiresAt'>}).session;
    // Keep the bounded conversation target after a successful search as well:
    // follow-up questions such as asking for the date of the displayed record
    // must reach the same classifier state without exposing the session to the
    // browser.
    if (workerSession && (result.status === 'clarification' || result.status === 'completed')) {
      this.sessions.set(activeSessionId, { ...workerSession, expiresAt: Date.now() + 10 * 60 * 1000 });
    } else {
      this.sessions.delete(activeSessionId);
    }
    const exact = this.settings.retrievalV2
      ? null
      : (result.searchPlan?.mode === 'exact' ? await this.searchExactNonconformity(result.searchPlan.args ?? {}) : null);
    // Source identities and spans remain in the worker; send only the existing text answer and the bounded confirmation state.
    return {
      status: result.status,
      answer: exact ? exact.answer : result.answer,
      recordIds: exact ? exact.recordIds : result.recordIds,
      elapsedMs: result.elapsedMs,
      confirmationPending: result.confirmationPending ?? null,
      searchState: result.searchState,
      searchDelta: result.searchDelta,
      searchPlan: result.searchPlan,
      searchDiagnostics: exact ? { ...result.searchDiagnostics, resultCount: exact.recordIds.length, source: 'postgresql' } as SearchDiagnostics : result.searchDiagnostics,
    };
  }

  private busyAnswer(): HermesTrialAnswer {
    return {
      status: 'unavailable',
      answer: BUSY_ANSWER,
      recordIds: [],
      elapsedMs: 0,
      confirmationPending: null,
    };
  }

  private acquireSlot(): Promise<void> {
    if (this.inflight < this.settings.maxInflight) {
      this.inflight += 1;
      return Promise.resolve();
    }
    if (this.waitQueue.length >= this.settings.maxQueue) {
      return Promise.reject(Object.assign(new Error('busy'), { busy: true }));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => { clearTimeout(timer); resolve(); },
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      };
      const timer = setTimeout(() => {
        this.waitQueue = this.waitQueue.filter((item) => item !== entry);
        reject(Object.assign(new Error('busy'), { busy: true }));
      }, this.settings.queueWaitMs);
      this.waitQueue.push(entry);
    });
  }

  private releaseSlot() {
    const next = this.waitQueue.shift();
    if (next) next.grant();
    else this.inflight = Math.max(0, this.inflight - 1);
  }

  private async answerRetrievalV2(question: string, sessionId?: string, pageContext?: HermesPageContext, options: HermesAnswerOptions = {}): Promise<HermesTrialAnswer> {
    await this.start();
    try {
      await this.acquireSlot();
    } catch (error) {
      if (error && typeof error === 'object' && 'busy' in error) return this.busyAnswer();
      throw error;
    }
    let written = false;
    const activeSessionId = sessionId ?? randomUUID();
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
    const stored = this.sessions.get(activeSessionId);
    const session = stored && stored.expiresAt > now ? stored : { pending: null, searchRequest: null, searchState: null, jevDialogue: [], expiresAt: now };
    try {
      const result = await new Promise<HermesTrialAnswer>((resolve, reject) => {
        const id = randomUUID();
        const timeout = setTimeout(() => {
          reject(new Error('検索の待ち時間を超えました。該当なしとは判断していません。'));
        }, 30000);
        this.pendingMap.set(id, {
          resolve: value => { clearTimeout(timeout); resolve(value); },
          reject: error => { clearTimeout(timeout); reject(error); },
        });
        this.child!.stdin.write(JSON.stringify({ type: 'request', requestId: id, question, session,
          ...(pageContext ? { pageContext } : {}), ...(options.principal ? { principal: options.principal } : {}) }) + '\n');
        written = true;
      });
      const workerSession = (result as HermesTrialAnswer & { session?: Omit<TrialSession, 'expiresAt'> }).session;
      if (workerSession && (result.status === 'clarification' || result.status === 'completed')) {
        this.sessions.set(activeSessionId, { ...workerSession, expiresAt: Date.now() + 10 * 60 * 1000 });
      } else {
        this.sessions.delete(activeSessionId);
      }
      return {
        status: result.status,
        answer: result.answer,
        recordIds: result.recordIds,
        elapsedMs: result.elapsedMs,
        confirmationPending: result.confirmationPending ?? null,
        searchState: result.searchState,
        searchDelta: result.searchDelta,
        searchPlan: result.searchPlan,
        searchDiagnostics: result.searchDiagnostics,
        dataAsOf: result.dataAsOf ?? null,
        ...(result.receipt && typeof result.receipt === 'object' ? { receipt: result.receipt } : {}),
      };
    } catch (error) {
      if (!written) this.releaseSlot();
      throw error;
    }
  }

  async rank(sourceId: RetrievalSourceId, query: string, limit = 50, allowedRecordIds?: string[]): Promise<HermesRankAvailability> {
    const unavailable = { available: false, mode: 'unavailable', recordIds: [] } as const;
    if (!this.settings.enabled || !this.settings.retrievalV2) return { ...unavailable, recordIds: [] };
    let written = false;
    let acquired = false;
    try {
      if (allowedRecordIds !== undefined && (!Array.isArray(allowedRecordIds) || allowedRecordIds.length > 20000
        || !allowedRecordIds.every(id => typeof id === 'string' && id.length > 0))) return { ...unavailable, recordIds: [] };
      if (!retrievalSourceIdsFromEnv().includes(sourceId)) return { ...unavailable, recordIds: [] };
      await this.start();
      if (!this.appliedCorpusSources.has(sourceId)) return { ...unavailable, recordIds: [] };
      await this.acquireSlot();
      acquired = true;
      const result = await new Promise<HermesRankResult>((resolve, reject) => {
        const id = randomUUID();
        const timeout = setTimeout(() => {
          // As with answers, retain ownership until the worker completes or exits.
          this.child?.stdin.write(JSON.stringify({ type: 'cancel', requestId: id }) + '\n');
          reject(new Error('rank timeout'));
        }, 30000);
        this.pendingMap.set(id, {
          kind: 'rank', resolve: value => { clearTimeout(timeout); resolve(value); },
          reject: error => { clearTimeout(timeout); reject(error); },
        });
        try {
          this.child!.stdin.write(JSON.stringify({ type: 'rank', requestId: id, sourceId, q: query, limit, ...(allowedRecordIds === undefined ? {} : { allowedRecordIds }) }) + '\n');
          written = true;
        } catch (error) {
          clearTimeout(timeout);
          this.pendingMap.delete(id);
          reject(error);
        }
      });
      return { available: true, mode: result.mode, recordIds: result.recordIds };
    } catch {
      if (acquired && !written) this.releaseSlot();
      return { ...unavailable, recordIds: [] };
    }
  }

  private async searchExactNonconformity(args: Record<string, unknown>): Promise<{ answer: string; recordIds: string[] }> {
    this.sourceSearch ??= new BusinessHermesMcpService();
    const response = await this.sourceSearch.call('business_hermes_search', args);
    const text = response.content.find((item) => item.type === 'text')?.text;
    if (!text || response.isError) throw new Error('既存のPostgreSQL検索を実行できませんでした。該当なしとは判断していません。');
    const payload = JSON.parse(text) as { results?: Array<{ kind?: string; id?: string; rawText?: string }> };
    const rows = (payload.results ?? []).filter((row) => row.kind === 'nonconformity' && typeof row.id === 'string');
    return {
      answer: rows.map((row) => row.rawText ?? '').filter(Boolean).join('\n\n') || '指定条件に一致する記録はありませんでした。',
      recordIds: rows.map((row) => `nonconformity:${row.id}`),
    };
  }

  private scheduleRefresh() {
    if (this.refreshTimer) return;
    void this.refreshCorpus();
    this.refreshTimer = setInterval(() => { void this.refreshCorpus(); }, this.settings.refreshSec * 1000);
  }

  private async loadAuthorizedRecords() {
    if (this.settings.loadRecords) return this.settings.loadRecords();
    let trainingReaders: ReturnType<typeof createTorqueTrainingSourceReaders> | undefined;
    const readers = registeredSourceReaders({
      nonconformity: () => this.loadNonconformityRecords(),
      procedures: () => this.loadProcedureRecords(),
      materials: loadProcedureMaterialRecords,
      training: () => trainingReaders ??= (this.settings.createTrainingReaders ?? createTorqueTrainingSourceReaders)(),
    }, this.retrievalSources);
    const records: Array<Record<string, unknown>> = [];
    for (const reader of readers) records.push(...await reader());
    return records;
  }

  private async loadProcedureRecords() {
    if (!this.procedures) {
      if (this.settings.procedures) this.procedures = this.settings.procedures;
      else {
        const { prisma } = await import('../../lib/prisma.js');
        const { PrismaKnowledgeProcedureRepository } = await import('../knowledge/prisma-knowledge-procedure.repository.js');
        this.procedures = new PrismaKnowledgeProcedureRepository(prisma);
      }
    }
    const records: Array<Record<string, unknown>> = [];
    for (const summary of await this.procedures.listPublished()) {
      const document = await this.procedures.getPublished(summary.procedureId);
      if (document?.state === 'published' && document.revisionNumber === summary.revisionNumber) {
        records.push(knowledgeProcedureRow({ ...document, publishedAt: summary.publishedAt }));
      }
    }
    return records;
  }

  private async loadNonconformityRecords() {
    this.sourceSearch ??= new BusinessHermesMcpService();
    const records: Array<Record<string, unknown>> = [];
    let offset = 0;
    for (;;) {
      const page = await this.sourceSearch.readSourcePage('nonconformity', offset);
      const text = page.content.find((item) => item.type === 'text')?.text;
      if (!text || page.isError) throw new Error('authorized read failed');
      const payload = JSON.parse(text) as {
        results?: Array<Record<string, unknown>>;
        hasMore?: { nonconformity?: boolean };
        nextCursor?: { nonconformityOffset?: number | null };
      };
      for (const row of payload.results ?? []) {
        if (row.kind === 'nonconformity') records.push(row);
      }
      if (!payload.hasMore?.nonconformity) break;
      const next = payload.nextCursor?.nonconformityOffset;
      if (!Number.isInteger(next) || (next as number) <= offset) break;
      offset = next as number;
    }
    return records;
  }

  private async refreshCorpus() {
    try {
      const records = await this.loadAuthorizedRecords();
      this.lastCorpusCount = records.length;
      // A removed publication must disappear on refresh; preserve the existing NC-only merge.
      const mode = this.corpusReady && this.retrievalSources.length === 1 && this.retrievalSources[0] === 'nonconformity' ? 'incremental' : 'full';
      this.corpusReady = true;
      this.child?.stdin.write(`${JSON.stringify({ type: 'corpus', mode, records, asOf: new Date().toISOString() })}\n`);
      const nonconformity = records.filter(row => (!row.kind || row.kind === 'nonconformity') && (!row.sourceId || row.sourceId === 'nonconformity'));
      this.kickEnrichment(nonconformity);
      this.kickFlywheel(nonconformity);
    } catch {
      console.warn(`hermes retrieval refresh failed count=${this.lastCorpusCount}`);
    }
  }

  private kickEnrichment(records: Array<Record<string, unknown>>) {
    if (process.env.HERMES_RETRIEVAL_ENRICHMENT_ENABLED !== 'true' || this.enrichmentChild || records.length === 0) return;
    const entry = process.env.HERMES_RETRIEVAL_ENRICHMENT_ENTRY
      ?? '/app/scripts/hermes-search/retrieval/enrichment-runner.mjs';
    let child: ChildProcessByStdio<Writable, null, null>;
    try {
      child = spawn(this.settings.node, [entry], { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      console.warn('hermes retrieval enrichment start failed');
      return;
    }
    this.enrichmentChild = child;
    const clear = () => { if (this.enrichmentChild === child) this.enrichmentChild = null; };
    child.once('spawn', () => { if (child.pid) try { setPriority(child.pid, 19); } catch { /* OS may reject the priority. */ } });
    child.once('error', () => { clear(); console.warn('hermes retrieval enrichment start failed'); });
    child.once('exit', clear);
    child.stdin.on('error', clear);
    child.stdin.write(JSON.stringify({ records }));
    child.stdin.end();
  }

  // The synthetic question flywheel (hermes-synthetic-question-flywheel-execplan.md) gets the same
  // corpus. The runner checks its night window and budget itself and exits at once outside them.
  private kickFlywheel(records: Array<Record<string, unknown>>) {
    if (process.env.HERMES_FLYWHEEL_ENABLED !== 'true' || this.flywheelChild || records.length === 0) return;
    const entry = process.env.HERMES_FLYWHEEL_ENTRY
      ?? '/app/scripts/hermes-search/retrieval/flywheel-runner.mjs';
    let child: ChildProcessByStdio<Writable, null, null>;
    try {
      child = spawn(this.settings.node, [entry], { env: process.env, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      console.warn('hermes retrieval flywheel start failed');
      return;
    }
    this.flywheelChild = child;
    const clear = () => { if (this.flywheelChild === child) this.flywheelChild = null; };
    child.once('spawn', () => { if (child.pid) try { setPriority(child.pid, 19); } catch { /* OS may reject the priority. */ } });
    child.once('error', () => { clear(); console.warn('hermes retrieval flywheel start failed'); });
    child.once('exit', clear);
    child.stdin.on('error', clear);
    child.stdin.write(JSON.stringify({ records }));
    child.stdin.end();
  }

  close() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.sessions.clear();
    this.appliedCorpusSources.clear();
    this.child?.kill('SIGTERM');
    this.enrichmentChild?.kill('SIGTERM');
    this.flywheelChild?.kill('SIGTERM');
  }
}
