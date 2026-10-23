import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    assemblyProcedureTextFeedback: { findFirst: vi.fn(), findMany: vi.fn() },
    assemblyProcedureLearnedTerm: { findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn()
  },
  runtime: { ensureReady: vi.fn(), release: vi.fn() },
  env: { BUSINESS_HERMES_BACKGROUND_ENABLED: 'false' },
  complete: vi.fn(), warn: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../../../config/env.js', () => ({ env: mocks.env }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../../inference/runtime/get-local-llm-runtime-controller.js', () => ({ getLocalLlmRuntimeController: () => mocks.runtime }));
vi.mock('../../inference/inference-runtime.js', () => ({ getInferenceRuntime: () => ({ createTextCompletionPort: () => ({ complete: mocks.complete }) }) }));
import { InferenceDeferredError } from '../../inference/ports/text-completion.port.js';
import { runProcedureTermLearningOnce } from '../procedure-term-learning.service.js';

const now = new Date('2026-10-20T00:00:00Z');
const pair = { wrong: '胃ケール', right: 'イケール', rowIds: ['invented'] };
const evidence = (aiText = '胃ケールを固定する', finalText = 'イケールを固定する') => [
  { id: 'one', documentId: 'doc1', aiText, finalText },
  { id: 'two', documentId: 'doc2', aiText, finalText }
];
const response = (pairs = [pair]) => ({ rawText: JSON.stringify({ pairs }), model: 'test' });
const run = (options = {}) => runProcedureTermLearningOnce({ now, ...options });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'false';
  mocks.db.assemblyProcedureLearnedTerm.findFirst.mockResolvedValue(null);
  mocks.db.assemblyProcedureTextFeedback.findFirst.mockImplementation(async ({ where }) => where.site === 'grinding' ? { id: 'one' } : null);
  mocks.db.assemblyProcedureTextFeedback.findMany.mockResolvedValue(evidence());
  mocks.db.$transaction.mockImplementation(async work => work(mocks.db));
  mocks.complete.mockResolvedValue(response());
});
afterEach(() => vi.restoreAllMocks());

describe('procedure term learning', () => {
  it('counts support from evidence, replaces only that site atomically and holds the runtime', async () => {
    const result = await run();
    expect(result).toEqual([
      { site: 'assembly', status: 'skipped', terms: [] },
      { site: 'grinding', status: 'updated', terms: [{ wrongText: pair.wrong, rightText: pair.right, occurrences: 2, documentCount: 2 }] }
    ]);
    expect(mocks.runtime.ensureReady).toHaveBeenCalledExactlyOnceWith('business_hermes');
    expect(mocks.runtime.release).toHaveBeenCalledExactlyOnceWith('business_hermes');
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ useCase: 'business_hermes', jsonOutput: true, temperature: 0, enableThinking: false, background: false }));
    expect(mocks.db.assemblyProcedureTextFeedback.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { site: 'grinding', outcome: 'EDITED', resolvedAt: { gte: new Date('2026-04-23T00:00:00Z'), lte: now } }, take: 300,
      orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }]
    }));
    expect(mocks.db.$transaction).toHaveBeenCalledOnce();
    expect(mocks.db.assemblyProcedureLearnedTerm.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { site: 'grinding' } });
    expect(mocks.db.assemblyProcedureLearnedTerm.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ site: 'grinding', wrongText: pair.wrong, rightText: pair.right, occurrences: 2, documentCount: 2, updatedAt: now }]
    });
  });
  it.each(['same-document', 'one-record', 'wrong-remains', 'right-absent', 'wrong-absent', 'null-final'])('rejects insufficient evidence: %s', async kind => {
    const rows = evidence();
    if (kind === 'same-document') rows[1].documentId = rows[0].documentId;
    if (kind === 'one-record') rows.pop();
    if (kind === 'wrong-remains') rows[1].finalText += ' 胃ケール';
    if (kind === 'right-absent') rows[1].finalText = '別の文';
    if (kind === 'wrong-absent') rows[1].aiText = '別の文';
    if (kind === 'null-final') (rows[1] as { finalText: string | null }).finalText = null;
    mocks.db.assemblyProcedureTextFeedback.findMany.mockResolvedValue(rows);
    expect((await run())[1].terms).toEqual([]);
    expect(mocks.db.assemblyProcedureLearnedTerm.createMany).not.toHaveBeenCalled();
  });
  it('protects words in the department knowledge', async () => {
    mocks.complete.mockResolvedValue(response([{ wrong: '磁力最大', right: '磁力MAX', rowIds: [] }]));
    mocks.db.assemblyProcedureTextFeedback.findMany.mockResolvedValue(evidence('磁力最大にする', '磁力MAXにする'));
    expect((await run())[1].terms).toEqual([]);
  });
  it.each([['a', 'b'], ['a'.repeat(21), 'b'], ['ab', ''], ['ab', 'b'.repeat(21)], ['ab', 'ab']])('rejects invalid lengths or equal terms (%s -> %s)', async (wrong, right) => {
    mocks.complete.mockResolvedValue(response([{ wrong, right, rowIds: [] }]));
    mocks.db.assemblyProcedureTextFeedback.findMany.mockResolvedValue(evidence(wrong, right));
    expect((await run())[1].terms).toEqual([]);
  });
  it('deduplicates conflicting wrong forms by support and caps the table at 40', async () => {
    const pairs = Array.from({ length: 42 }, (_, i) => ({ wrong: `誤語[${i}]`, right: `正語[${i}]`, rowIds: [] }));
    const rows = pairs.flatMap((p, i) => evidence(p.wrong, p.right).map(row => ({ ...row, id: `${row.id}-${i}` })));
    rows.push({ id: 'extra', documentId: 'doc3', aiText: pairs[41].wrong, finalText: pairs[41].right });
    mocks.db.assemblyProcedureTextFeedback.findMany.mockResolvedValue(rows);
    mocks.complete.mockResolvedValue(response([...pairs, pairs[0], { ...pairs[0], right: '正語' }]));
    const terms = (await run())[1].terms;
    expect(terms).toHaveLength(40);
    expect(terms[0]).toMatchObject({ wrongText: pairs[41].wrong, occurrences: 3, documentCount: 3 });
    expect(new Set(terms.map(term => term.wrongText)).size).toBe(40);
    expect(mocks.complete).toHaveBeenCalledTimes(3);
    expect(mocks.complete.mock.calls.map(([request]) => JSON.parse(request.messages[1].content).rows.length)).toEqual([40, 40, 5]);
  });
  it('skips without acquiring the runtime or calling the LLM when there is no new correction', async () => {
    mocks.db.assemblyProcedureLearnedTerm.findFirst.mockResolvedValue({ updatedAt: now });
    mocks.db.assemblyProcedureTextFeedback.findFirst.mockResolvedValue(null);
    expect((await run()).every(result => result.status === 'skipped')).toBe(true);
    expect(mocks.db.assemblyProcedureTextFeedback.findFirst).toHaveBeenCalledWith({
      where: { site: 'grinding', outcome: 'EDITED', resolvedAt: { gt: now } }, select: { id: true }
    });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.runtime.ensureReady).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it('skips an empty site without learned terms', async () => {
    mocks.db.assemblyProcedureTextFeedback.findFirst.mockResolvedValue(null);
    expect((await run()).every(result => result.status === 'skipped')).toBe(true);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('dry run returns proposals and writes nothing', async () => {
    expect((await run({ dryRun: true }))[1]).toMatchObject({ status: 'dry-run', terms: [expect.objectContaining({ occurrences: 2 })] });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.db.assemblyProcedureLearnedTerm.deleteMany).not.toHaveBeenCalled();
    expect(mocks.db.assemblyProcedureLearnedTerm.createMany).not.toHaveBeenCalled();
  });
  it('uses background admission without holding the runtime', async () => {
    mocks.env.BUSINESS_HERMES_BACKGROUND_ENABLED = 'true';
    await run();
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ background: true }));
    expect(mocks.runtime.ensureReady).not.toHaveBeenCalled();
    expect(mocks.runtime.release).not.toHaveBeenCalled();
  });
  it.each([new Error('LLM failed'), new InferenceDeferredError()])('leaves learned terms untouched after failure or deferral (%s)', async error => {
    mocks.complete.mockRejectedValue(error);
    expect((await run())[1].status).toBe('failed');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.runtime.release).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalled();
  });
  it.each(['not JSON', '{}', '{"pairs":[{"wrong":3}]}'])('leaves the table unchanged on malformed output (%s)', async rawText => {
    mocks.complete.mockResolvedValue({ rawText });
    expect((await run())[1].status).toBe('failed');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it('leaves the whole table unchanged if a later chunk fails', async () => {
    mocks.db.assemblyProcedureTextFeedback.findMany.mockResolvedValue(Array.from({ length: 41 }, (_, i) => ({ ...evidence()[0], id: String(i) })));
    mocks.complete.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('later chunk failed'));
    expect((await run())[1].status).toBe('failed');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it('honors cancellation before replacing terms and releases the runtime', async () => {
    const abort = new AbortController();
    mocks.complete.mockImplementation(async () => { abort.abort(); return response(); });
    expect((await run({ signal: abort.signal }))[1].status).toBe('failed');
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect(mocks.runtime.release).toHaveBeenCalledOnce();
  });
});
