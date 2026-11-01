import { mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InferenceDeferredError, type TextCompletionRequest, type TextCompletionResult } from '../inference/ports/text-completion.port.js';
import { logger } from '../../lib/logger.js';
import { fingerprint, MATERIAL_BYTES } from './material.js';
import { atomicJson, ensureQueue, queueCounts, readQueueResults, resultSchema, reviewActivity } from './queue-storage.js';
import { halveMaterial } from './review-completion.js';
import { jobUnits, quietTime, SecurityReviewQueueService } from './security-review-queue.service.js';

vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let root: string;
let current: Date;
const answer: TextCompletionResult = { rawText: '{"findings":[],"refusedOrVague":false}', model: 'synthetic', finishReason: 'stop' };
const lengthAnswer = { ...answer, rawText: '', finishReason: 'length' };
const complete = vi.fn<(request: TextCompletionRequest) => Promise<TextCompletionResult>>();
const finding = { kind: 'changes' as const, location: 'app.ts:1', what: 'Synthetic missing authorization',
  whyItMatters: 'Synthetic protected data disclosure', severity: 'medium' as const, evidenceRef: 'app.ts:1' };
const name = (sha: string) => `${sha}.json`;
const filename = (folder: string, sha: string) => path.join(root, 'queue', folder, name(sha));
const json = async (folder: string, sha: string) => JSON.parse(await readFile(filename(folder, sha), 'utf8'));
const service = () => new SecurityReviewQueueService({ dataDir: root, quiet: '05:50-07:00', completion: { complete }, now: () => current });
const tick = () => service().tick(new AbortController().signal);
const material = (request: TextCompletionRequest): string => JSON.parse(request.messages[1]!.content
  .slice('BEGIN_REVIEW_DATA\n'.length, -'\nEND_REVIEW_DATA'.length)).material;
async function enqueue(sha = 'a'.repeat(40), files = [{ path: 'app.ts', diff: '+synthetic line\n' }], committedAt = '2026-10-30T01:00:00.000Z') {
  const job = { version: 1, sha, parent: null, committedAt, enqueuedAt: current.toISOString(), files,
    bytes: files.reduce((total, file) => total + Buffer.byteLength(file.diff), 0), omittedFiles: 0 };
  await atomicJson(filename('pending', sha), job);
  return sha;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'security-review-queue-test-'));
  current = new Date('2026-10-31T12:00:00+09:00');
  vi.mocked(logger.warn).mockClear();
  complete.mockReset().mockResolvedValue(answer);
  vi.mocked(rename).mockClear();
  reviewActivity.nightly = false; reviewActivity.queueUnit = null;
  await ensureQueue(root);
});
afterEach(async () => {
  reviewActivity.nightly = false; reviewActivity.queueUnit = null;
  vi.mocked(rename).mockReset();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockImplementation(actual.rename);
  await rm(root, { recursive: true, force: true });
});

describe('commit review queue', () => {
  it('reviews pending jobs oldest first, writes private results and clears finished progress', async () => {
    const newer = await enqueue('b'.repeat(40));
    const older = await enqueue('a'.repeat(40), undefined, '2026-10-29T01:00:00.000Z');
    await tick();
    expect(resultSchema.parse(await json('done', older))).toMatchObject({ status: 'done', units: 1, failedUnits: [], reportedAt: null });
    expect((await stat(filename('done', older))).mode & 0o777).toBe(0o600);
    for (const folder of ['pending', 'claimed', 'done', 'failed', 'progress']) {
      expect((await stat(path.join(root, 'queue', folder))).mode & 0o777).toBe(0o700);
    }
    await expect(stat(filename('claimed', older))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(filename('progress', older))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await json('done', newer)).toMatchObject({ sha: newer });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]![0]).toMatchObject({ useCase: 'security_review', maxTokens: 2000, timeoutMs: 120_000, background: true });
    expect(await queueCounts(root)).toEqual({ pending: 0, claimed: 0, failed: 0, invalid: 0, oldestPendingCommittedAt: null });
  });

  it('replaces a length-truncated unit with two line-aligned halves and reviews both', async () => {
    const text = '+synthetic line\n'.repeat(400);
    const sha = await enqueue(undefined, [{ path: 'app.ts', diff: text }]);
    complete.mockResolvedValueOnce(lengthAnswer);
    await tick();
    expect(complete).toHaveBeenCalledTimes(3);
    const inputs = complete.mock.calls.map(([request]) => material(request));
    expect(inputs[0]).toBe(text);
    expect(inputs[1]! + inputs[2]!).toBe(text);
    expect(inputs[1]!.endsWith('\n')).toBe(true);
    expect(inputs.slice(1).every(input => Buffer.byteLength(input) >= 1024 && Buffer.byteLength(input) < Buffer.byteLength(text))).toBe(true);
    expect(await json('done', sha)).toMatchObject({ units: 2, failedUnits: [] });
  });

  it('keeps minimum-unit truncation as a failed result with a path and reason', async () => {
    const sha = await enqueue(undefined, [{ path: 'app.ts', diff: '界'.repeat(300) }]);
    complete.mockResolvedValue(lengthAnswer);
    await tick();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await json('failed', sha)).toMatchObject({ status: 'failed', units: 1,
      failedUnits: [{ path: 'app.ts', reason: 'length_at_minimum_unit' }], reportedAt: null });
    expect((await queueCounts(root)).failed).toBe(1);
    await expect(stat(filename('pending', sha))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([new InferenceDeferredError(), new TypeError('fetch failed')])('preserves successful progress and resumes after unavailable inference: %s', async error => {
    const sha = await enqueue(undefined, [{ path: 'first.ts', diff: '+first\n' }, { path: 'second.ts', diff: '+second\n' }]);
    complete.mockResolvedValueOnce({ ...answer, rawText: JSON.stringify({ findings: [finding], refusedOrVague: false }) }).mockRejectedValueOnce(error);
    await tick();
    expect((await json('progress', sha)).units.map((unit: { result?: unknown }) => Boolean(unit.result))).toEqual([true, false]);
    expect((await stat(filename('progress', sha))).mode & 0o777).toBe(0o600);
    expect(await json('pending', sha)).toMatchObject({ sha });
    complete.mockClear().mockResolvedValue(answer);
    await tick();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(material(complete.mock.calls[0]![0])).toBe('+second\n');
    expect(await json('done', sha)).toMatchObject({ units: 2, findings: [finding] });
  });

  it('defers the first two vague answers for 30 minutes and fails the third without blocking other jobs', async () => {
    const sha = await enqueue('a'.repeat(40), [
      { path: 'app.ts', diff: '+synthetic line\n' }, { path: 'later.ts', diff: '+later\n' },
    ], '2026-10-29T01:00:00.000Z');
    const vague = { ...answer, rawText: '{"findings":[],"refusedOrVague":true}' };
    complete.mockResolvedValueOnce(vague);
    const next = await enqueue('b'.repeat(40));
    await tick();
    expect(await json('done', next)).toMatchObject({ sha: next });
    expect(complete).toHaveBeenCalledTimes(2);
    for (const attempt of [1, 2]) {
      const progress = await json('progress', sha);
      expect(progress.units[0]).toMatchObject({ vagueAttempts: attempt,
        retryAfter: new Date(current.getTime() + 30 * 60_000).toISOString() });
      expect(progress.units[0].result).toBeUndefined();
      expect(await json('pending', sha)).toMatchObject({ sha });
      const other = await enqueue(String(attempt).repeat(40));
      complete.mockClear();
      await tick();
      expect(await json('done', other)).toMatchObject({ sha: other });
      expect(complete).toHaveBeenCalledTimes(1);
      complete.mockClear().mockResolvedValueOnce(vague);
      current = new Date(current.getTime() + 30 * 60_000);
      await tick();
    }
    expect(await json('failed', sha)).toMatchObject({ units: 2,
      failedUnits: [{ path: 'app.ts', reason: 'refused_or_vague' }] });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, { sha, path: 'app.ts', vagueAttempts: 1 }, expect.any(String));
    expect(logger.warn).toHaveBeenNthCalledWith(2, { sha, path: 'app.ts', vagueAttempts: 2 }, expect.any(String));
  });

  it('reads legacy progress without vagueAttempts and succeeds on a deferred retry', async () => {
    const sha = await enqueue();
    await atomicJson(filename('progress', sha), { version: 1, sha,
      units: [{ id: '0', path: 'app.ts', text: '+legacy\n', attempts: 0 }] });
    complete.mockResolvedValueOnce({ ...answer, rawText: '{"findings":[],"refusedOrVague":true}' });
    await tick();
    expect((await json('progress', sha)).units[0].vagueAttempts).toBe(1);
    current = new Date(current.getTime() + 30 * 60_000);
    await tick();
    expect(await json('done', sha)).toMatchObject({ failedUnits: [] });
    expect(material(complete.mock.calls[1]![0])).toBe('+legacy\n');
    expect((await queueCounts(root)).invalid).toBe(0);
  });

  it('moves on to the next pending job when another process wins the claim rename', async () => {
    const first = await enqueue('a'.repeat(40), undefined, '2026-10-29T01:00:00.000Z');
    const next = await enqueue('b'.repeat(40));
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(async (source, destination) => {
      await actual.rename(source, destination);
      throw Object.assign(new Error('claimed by another worker'), { code: 'ENOENT' });
    });
    await tick();
    expect(await json('claimed', first)).toMatchObject({ sha: first });
    expect(await json('done', next)).toMatchObject({ sha: next });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('reclaims stale claimed jobs while leaving fresh claims alone', async () => {
    const stale = await enqueue('a'.repeat(40));
    const fresh = await enqueue('b'.repeat(40));
    for (const sha of [stale, fresh]) await rename(filename('pending', sha), filename('claimed', sha));
    const cutoff = new Date(current.getTime() - 2 * 60 * 60_000);
    await utimes(filename('claimed', stale), cutoff, cutoff);
    await utimes(filename('claimed', fresh), current, current);
    await tick();
    expect(await json('done', stale)).toMatchObject({ sha: stale });
    expect(await json('claimed', fresh)).toMatchObject({ sha: fresh });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('starts no work during the quiet interval or while nightly owns inference', async () => {
    const sha = await enqueue();
    current = new Date('2026-10-31T06:00:00+09:00');
    await tick();
    current = new Date('2026-10-31T12:00:00+09:00');
    reviewActivity.nightly = true;
    await tick();
    expect(complete).not.toHaveBeenCalled();
    expect(await json('pending', sha)).toMatchObject({ sha });
  });

  it.each(['quiet', 'nightly'] as const)('finishes the current unit and pauses before the next for %s', async mode => {
    const sha = await enqueue(undefined, [{ path: 'first.ts', diff: '+first\n' }, { path: 'second.ts', diff: '+second\n' }]);
    complete.mockImplementationOnce(async () => {
      if (mode === 'quiet') current = new Date('2026-11-01T05:50:00+09:00');
      else reviewActivity.nightly = true;
      return answer;
    });
    await tick();
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await json('progress', sha)).units.map((unit: { result?: unknown }) => Boolean(unit.result))).toEqual([true, false]);
    expect(await json('pending', sha)).toMatchObject({ sha });
    current = new Date('2026-11-01T12:00:00+09:00'); reviewActivity.nightly = false;
    await tick();
    expect(await json('done', sha)).toMatchObject({ units: 2 });
  });

  it('guards overlapping ticks and exposes the current call to the nightly review', async () => {
    const sha = await enqueue();
    let release!: (value: TextCompletionResult) => void;
    let started!: () => void;
    const begin = new Promise<void>(resolve => { started = resolve; });
    complete.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const worker = service();
    const first = worker.tick(new AbortController().signal);
    await begin;
    expect(reviewActivity.queueUnit).toBeInstanceOf(Promise);
    await worker.tick(new AbortController().signal);
    expect(complete).toHaveBeenCalledTimes(1);
    release(answer); await first;
    expect(reviewActivity.queueUnit).toBeNull();
    expect(await json('done', sha)).toMatchObject({ sha });
  });

  it('does not repeat a committed result after a crash before claimed cleanup', async () => {
    const sha = await enqueue();
    await atomicJson(filename('done', sha), { version: 1, sha, committedAt: current.toISOString(), finishedAt: current.toISOString(),
      status: 'done', units: 1, failedUnits: [], findings: [], reportedAt: null });
    await tick();
    expect(complete).not.toHaveBeenCalled();
    await expect(stat(filename('pending', sha))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(filename('claimed', sha))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['{', '{"version":99}'])('quarantines malformed pending and done and continues: %s', async content => {
    const bad = 'b'.repeat(40);
    await writeFile(filename('pending', bad), content);
    await writeFile(filename('done', bad), content);
    const good = await enqueue();
    await tick();
    expect(await json('done', good)).toMatchObject({ sha: good });
    expect(await readQueueResults(root)).toHaveLength(1);
    expect(await queueCounts(root)).toMatchObject({ invalid: 2, pending: 0 });
    for (const folder of ['pending', 'done']) {
      expect(await readFile(path.join(root, 'queue/invalid', `${folder}-${bad}.json`), 'utf8')).toBe(content);
    }
  });

  it.each(['{', '{"version":99}', 'mismatch'])('quarantines invalid progress and restarts: %s', async content => {
    const sha = await enqueue();
    await writeFile(filename('progress', sha), content === 'mismatch'
      ? JSON.stringify({ version: 1, sha: 'b'.repeat(40), units: [] }) : content);
    await tick();
    expect(await json('done', sha)).toMatchObject({ units: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await queueCounts(root)).toMatchObject({ invalid: 1 });
  });

  it('continues after cleaning up an already published claim', async () => {
    const sha = await enqueue();
    await atomicJson(filename('done', sha), { version: 1, sha, committedAt: current.toISOString(), finishedAt: current.toISOString(),
      status: 'done', units: 1, failedUnits: [], findings: [], reportedAt: null });
    const next = await enqueue('b'.repeat(40));
    await tick();
    expect(await json('done', next)).toMatchObject({ sha: next });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('persists timeout attempts, splits after two and fails minimum units', async () => {
    const sha = await enqueue(undefined, [{ path: 'app.ts', diff: 'x'.repeat(2048) }]);
    complete.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError')).mockRejectedValueOnce(new InferenceDeferredError());
    await tick();
    expect((await json('progress', sha)).units[0]).toMatchObject({ attempts: 1 });
    complete.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await tick();
    expect(await json('failed', sha)).toMatchObject({ units: 2, failedUnits: [
      { path: 'app.ts', reason: 'timeout_at_minimum_unit' }, { path: 'app.ts', reason: 'timeout_at_minimum_unit' },
    ] });
    expect(complete).toHaveBeenCalledTimes(7);
  });

  it('counts service call deadline aborts as timeouts', async () => {
    const sha = await enqueue();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort(new DOMException('deadline', 'TimeoutError')));
    complete.mockImplementation(async request => { request.signal!.throwIfAborted(); return answer; });
    try { await tick(); } finally { timeout.mockRestore(); }
    expect(await json('failed', sha)).toMatchObject({ failedUnits: [{ reason: 'timeout_at_minimum_unit' }] });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('filters known findings using the nightly fingerprint and quoted prompt', async () => {
    const sha = await enqueue();
    await writeFile(path.join(root, 'known-findings.json'), JSON.stringify([{ fingerprint: fingerprint(finding),
      kind: finding.kind, location: finding.location, what: finding.what, reason: 'Synthetic verified false alarm', date: '2026-10-30' }]));
    complete.mockResolvedValue({ ...answer, rawText: JSON.stringify({ findings: [finding], refusedOrVague: false }) });
    await tick();
    expect(await json('done', sha)).toMatchObject({ findings: [] });
    expect(complete.mock.calls[0]![0].messages[1]!.content).toContain(finding.what);
  });
});

describe('queue unit boundaries', () => {
  it('preserves file and line boundaries and all UTF-8 content, including oversized lines', () => {
    const files = [{ path: 'a.ts', diff: '+a\n'.repeat(3000) }, { path: 'b.ts', diff: '界'.repeat(4000) }];
    const units = jobUnits(files);
    for (const file of files) expect(units.filter(unit => unit.path === file.path).map(unit => unit.text).join('')).toBe(file.diff);
    for (const unit of units) {
      expect(Buffer.byteLength(unit.text)).toBeLessThanOrEqual(MATERIAL_BYTES);
      expect(unit.text).not.toContain('\uFFFD');
    }
    const halves = halveMaterial('界'.repeat(2000))!;
    expect(halves.join('')).toBe('界'.repeat(2000));
    expect(halves.every(half => Buffer.byteLength(half) >= 1024 && !half.includes('\uFFFD'))).toBe(true);
    expect(halveMaterial('x'.repeat(1024))).toBeNull();
  });

  it('uses JST and treats quiet intervals as start-inclusive/end-exclusive, including midnight', () => {
    expect(quietTime(new Date('2026-10-31T05:50:00+09:00'), '05:50-07:00')).toBe(true);
    expect(quietTime(new Date('2026-10-31T07:00:00+09:00'), '05:50-07:00')).toBe(false);
    expect(quietTime(new Date('2026-10-31T23:30:00+09:00'), '23:00-02:00')).toBe(true);
    expect(quietTime(new Date('2026-11-01T01:00:00+09:00'), '23:00-02:00')).toBe(true);
    expect(quietTime(new Date('2026-11-01T02:00:00+09:00'), '23:00-02:00')).toBe(false);
  });
});
