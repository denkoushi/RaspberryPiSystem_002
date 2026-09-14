import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { BUSINESS_HERMES_BACKGROUND_ENABLED: 'false', BUSINESS_HERMES_NIGHTLY_DATA_DIR: '', BUSINESS_HERMES_ANSWER_CACHE_URL: 'http://cache.test', BUSINESS_HERMES_ANSWER_CACHE_TOKEN: 'test-token' },
  complete: vi.fn(), detail: vi.fn(), export: vi.fn(), ready: vi.fn(), release: vi.fn(), fetch: vi.fn()
}));
vi.mock('../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { businessHermesConsultationMessage: { findMany: async () => [] }, alert: { findFirst: async () => null, create: async () => ({}) } } }));
vi.mock('../../lib/logger.js', () => ({ logger: { info: vi.fn() } }));
vi.mock('./business-hermes-mcp.service.js', () => ({ BusinessHermesMcpService: class { call = mocks.detail; } }));
vi.mock('./business-hermes-source-export.js', () => ({ exportBusinessHermesSources: mocks.export }));
vi.mock('../inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({ createTextCompletionPort: () => ({ complete: mocks.complete }) }) }));
vi.mock('../inference/runtime/get-local-llm-runtime-controller.js', () => ({ getLocalLlmRuntimeController: () => ({ ensureReady: mocks.ready, release: mocks.release }) }));
vi.mock('node:timers/promises', () => ({ setTimeout: async () => undefined }));

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { BusinessHermesNightlyService } from './business-hermes-nightly.service.js';
import { sourceDocument } from './business-hermes-source-adapters.js';

describe('Nightly preparation with no new conversations', () => {
  const question = 'MD001を加工する前に必要なことは？';
  const record = { kind: 'work_instruction', id: 'one', partNumber: 'MD001', shootingTarget: '加工',
    rows: [{ steps: [{ step: 1, effectiveText: '設計へ相談してから加工。' }] }] };
  const json = (value: unknown) => ({ model: 'synthetic-test-model', rawText: JSON.stringify(value) });
  let state: { baseCatalogueRelative: string; baseCatalogueSha256: string; catalogue: { version: number; cases: unknown[] }; events: unknown[]; running: boolean };
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'false';
    mocks.complete.mockReset();
    mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'hermes-document-test-'));
    await writeFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'checks.json'), JSON.stringify({ version: 1,
      cases: ['工具返却', '設備停止', '検査場所', '部品廃棄'].map((q, i) => ({ id: String(i), question: q })) }));
    await writeFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'holdout.json'), JSON.stringify({ version: 1,
      cases: ['独立検査一', '独立検査二', '独立検査三', '独立検査四'].map((question, i) => ({ id: 'h' + i, question })) }));
    state = { baseCatalogueRelative: 'reviewed.json', baseCatalogueSha256: 'base', catalogue: { version: 1, cases: [] }, events: [], running: false };
    mocks.fetch.mockImplementation(async (url: URL) => new Response(JSON.stringify({ result:
      url.pathname.endsWith('/state') ? state : url.pathname.endsWith('/status') ? { status: 'awaiting_holdout', activated: false } : { started: true } })));
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.detail.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(record) }] });
    mocks.export.mockResolvedValue({ version: 2, records: [sourceDocument(record)] });
    mocks.complete.mockResolvedValueOnce(json({ questions: [question] }))
      .mockResolvedValueOnce(json({ quote_ids: ['work_instruction:one#/steps/0/text'] }))
      .mockResolvedValueOnce(json({ verdict: 'pass', reason: '条件を含む', missing: [], unsupported: [] }));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, { recursive: true, force: true });
  });
  async function prepared() {
    const root = mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR;
    const jobs = await readdir(path.join(root, 'jobs'));
    const read = async (name: string) => JSON.parse(await readFile(path.join(root, 'jobs', jobs[0]!, name), 'utf8'));
    return { candidate: await read('candidate.json'), input: await read('input.json'), facts: await read('fact-candidate.json') };
  }
  it('asks DGX for source-supported questions without a holdout and preserves abstention checks', async () => {
    mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'true';
    await rm(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'holdout.json'));
    await writeFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'checks.json'), JSON.stringify({ version: 1,
      cases: ['工具返却', '設備停止', '検査場所', '部品廃棄'].map((question, i) => ({ id: String(i), question, expectedSource: null })) }));
    const published = { ...record, public: true, rows: [{ ...record.rows[0], sourceVersionDate: '2026-09-01', publication: { publishedVersionId: 'v1' } }] };
    mocks.detail.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(published) }] });
    const alias = '図番MD001・対象加工の公開要領の作業手順は？';
    mocks.complete.mockReset().mockResolvedValue(json({ questions: [alias] }));
    const result = await new BusinessHermesNightlyService().run(new AbortController().signal);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete.mock.calls[0]![0]).toMatchObject({background: true});
    expect((await prepared()).facts.cases[0].queries).toContain(alias);
    expect(JSON.stringify(mocks.complete.mock.calls)).not.toContain('工具返却');
    expect(mocks.ready).not.toHaveBeenCalled();
    expect((await prepared()).facts.cases).toHaveLength(1);
    expect(result.documentProgress).toEqual({ total: 1, processed: 1, remaining: 0 });
    expect(JSON.parse(await readFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'document-attempts.json'), 'utf8'))).toHaveProperty('work_instruction:one');
  });
  it('pauses source-only DGX work on private use and resumes the same document later', async () => {
    mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'true';
    await rm(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'holdout.json'));
    const published = { ...record, public: true, rows: [{ ...record.rows[0], sourceVersionDate: '2026-09-01', publication: { publishedVersionId: 'v1' } }] };
    mocks.detail.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(published) }] });
    mocks.complete.mockReset().mockRejectedValueOnce(new InferenceDeferredError());
    expect(await new BusinessHermesNightlyService().run(new AbortController().signal)).toMatchObject({status: 'deferred'});
    await expect(readFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'document-attempts.json'))).rejects.toMatchObject({code: 'ENOENT'});
    expect(mocks.fetch.mock.calls.some(([url]) => (url as URL).pathname.endsWith('/start'))).toBe(false);
    mocks.complete.mockResolvedValue(json({questions: ['図番MD001・対象加工の公開要領の作業手順は？']}));
    expect(await new BusinessHermesNightlyService().run(new AbortController().signal)).toMatchObject({documentProgress: {processed: 1}});
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it('does not checkpoint invented model questions and retains only the source quote', async () => {
    await rm(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'holdout.json'));
    const published = { ...record, public: true, rows: [{ ...record.rows[0], sourceVersionDate: '2026-09-01', publication: { publishedVersionId: 'v1' } }] };
    mocks.detail.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(published) }] });
    mocks.complete.mockReset().mockResolvedValue(json({questions: ['図番MD002を80℃で加工してよい？']}));
    const result = await new BusinessHermesNightlyService().run(new AbortController().signal);
    expect(result.documentProgress?.processed).toBe(0);
    const { facts, input } = await prepared();
    expect(facts.cases[0].queries).toHaveLength(1);
    expect(input.decisions[0]).toMatchObject({origin:'source-question', verdict:'failed'});
  });
  it('does not consume document progress when the validation worker fails', async () => {
    await rm(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'holdout.json'));
    mocks.fetch.mockImplementation(async (url: URL) => new Response(JSON.stringify({ result:
      url.pathname.endsWith('/state') ? state : url.pathname.endsWith('/status') ? { status: 'failed', activated: false } : { started: true } })));
    expect(await new BusinessHermesNightlyService().run(new AbortController().signal)).toMatchObject({status: 'failed'});
    await expect(readFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'document-attempts.json'))).rejects.toMatchObject({code: 'ENOENT'});
  });
  it('defers background work without consuming the document checkpoint or starting DGX', async () => {
    mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'true';
    mocks.complete.mockReset().mockRejectedValue(new InferenceDeferredError());
    expect(await new BusinessHermesNightlyService().run(new AbortController().signal)).toMatchObject({ status: 'deferred' });
    expect(mocks.ready).not.toHaveBeenCalled();
    expect(mocks.complete.mock.calls[0]![0]).toMatchObject({ background: true });
    await expect(readFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'document-attempts.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('uses no inference when background source work is empty', async () => {
    mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'true';
    mocks.export.mockResolvedValue({ version: 1, records: [] });
    expect(await new BusinessHermesNightlyService().run(new AbortController().signal)).toMatchObject({ status: 'no_work' });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it('stages a source-quoted answer and releases the lease; evaluation stays out of prompts', async () => {
    await new BusinessHermesNightlyService().run(new AbortController().signal);
    const { candidate, input } = await prepared();
    expect(candidate.cases).toHaveLength(1);
    expect(candidate.cases[0]).toMatchObject({ question, answer: '設計へ相談してから加工。', sources: [{ kind: 'work_instruction', id: 'one' }] });
    expect(input).toMatchObject({ holdoutSha256: expect.any(String), decisions: [{ origin: 'document', verdict: 'pass' }] });
    expect(JSON.stringify(mocks.complete.mock.calls)).not.toContain('工具返却');
    expect(mocks.release).toHaveBeenCalledWith('business_hermes');
    expect(mocks.complete).toHaveBeenCalledTimes(3);
  });
  it('freezes factual evidence before model generation without giving the model evaluation questions', async () => {
    const published = { ...record, public: true, rows: [{ ...record.rows[0], sourceVersionDate: '2026-09-01', publication: { publishedVersionId: 'v1' } }] };
    mocks.detail.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(published) }] });
    mocks.complete.mockReset().mockImplementation(async () => {
      const root = mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR;
      const [id] = await readdir(path.join(root, 'jobs'));
      const evidence = JSON.parse(await readFile(path.join(root, 'jobs', id!, 'fact-evidence.json'), 'utf8'));
      const facts = JSON.parse(await readFile(path.join(root, 'jobs', id!, 'fact-candidate.json'), 'utf8'));
      expect(evidence.records).toHaveLength(1);
      expect(Object.keys(evidence.records[0].source).sort()).toEqual(['id', 'kind', 'sha256']);
      expect(facts.cases[0].answer).toContain('設計へ相談してから加工。');
      return json({ questions: [] });
    });
    await new BusinessHermesNightlyService().run(new AbortController().signal);
    const { input } = await prepared();
    expect(input.factEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(input.factCandidateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(mocks.complete.mock.calls)).not.toContain('記載本文を確認したい');
  });
  it('does not admit an answer when the reviewer reports omitted conditions', async () => {
    mocks.complete.mockReset().mockResolvedValueOnce(json({ questions: [question] }))
      .mockResolvedValueOnce(json({ quote_ids: ['work_instruction:one#/steps/0/text'] }))
      .mockResolvedValueOnce(json({ verdict: 'pass', reason: '条件不足', missing: ['条件'], unsupported: [] }));
    await new BusinessHermesNightlyService().run(new AbortController().signal);
    expect((await prepared()).candidate.cases).toHaveLength(0);
  });
  it('filters protected questions and invented numbers before answer generation', async () => {
    await writeFile(path.join(mocks.env.BUSINESS_HERMES_NIGHTLY_DATA_DIR, 'holdout.json'), JSON.stringify({ version: 1,
      cases: [question, '工具返却後の確認', '未登録の寸法', '今日の天気'].map((q, i) => ({ id: String(i), question: q })) }));
    mocks.complete.mockReset().mockResolvedValueOnce(json({ questions: [question, 'MD001を20mm加工してよい？'] }));
    await new BusinessHermesNightlyService().run(new AbortController().signal);
    const { candidate, input } = await prepared();
    expect(candidate.cases).toHaveLength(0);
    expect(input.decisions.map((d: { reason: string }) => d.reason)).toEqual(['duplicate_or_protected', 'unsupported_number']);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.complete.mock.calls)).not.toContain('今日の天気');
  });
  it('keeps user rejection authoritative even for a newly generated question', async () => {
    const { sourceFingerprint } = await import('./business-hermes-answer-cache.js');
    state.events = [{ id: 'rejected', question: '以前の質問', canonical: null, answer: '設計へ相談してから加工。', verdict: 'unhelpful',
      sources: [{ kind: 'work_instruction', id: 'one', sha256: sourceFingerprint(await mocks.detail()) }] }];
    await new BusinessHermesNightlyService().run(new AbortController().signal);
    expect((await prepared()).candidate.cases).toHaveLength(0);
    expect((await prepared()).input.decisions[0].reason).toBe('negative_feedback');
  });
  it('does not delete disputed legacy answers through the separate fact adoption path', async () => {
    const { sourceFingerprint } = await import('./business-hermes-answer-cache.js');
    const sources = [{ kind: 'work_instruction', id: 'one', sha256: sourceFingerprint(await mocks.detail()) }];
    const existing = { question, queries: [question], answer: '設計へ相談してから加工。', sources,
      review: { verdict: 'pass', reviewer: 'fixture', reason: 'source', reviewedAt: '2026-09-14' } };
    state.catalogue.cases = [existing];
    state.events = [{ id: 'rejected', question, canonical: question, answer: existing.answer, verdict: 'unhelpful', sources }];
    await new BusinessHermesNightlyService().run(new AbortController().signal);
    const { candidate, facts } = await prepared();
    expect(candidate.cases).toHaveLength(0);
    expect(facts.cases).toEqual([existing]);
  });
  it('releases inference on cancellation and never starts the worker', async () => {
    const controller = new AbortController();
    mocks.complete.mockReset().mockImplementation(async () => { controller.abort(); throw new Error('cancelled'); });
    await expect(new BusinessHermesNightlyService().run(controller.signal)).rejects.toThrow();
    expect(mocks.release).toHaveBeenCalledWith('business_hermes');
    expect(mocks.fetch.mock.calls.some(([url]) => (url as URL).pathname.endsWith('/start'))).toBe(false);
  });
});
