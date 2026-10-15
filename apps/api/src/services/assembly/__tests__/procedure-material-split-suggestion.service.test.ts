import type { ProcedureMaterial } from '@prisma/client';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureMaterialSplitSuggestionService } from '../procedure-material-split-suggestion.service.js';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn() } }));

const photo = (id: string, overrides: Partial<ProcedureMaterial> = {}) => ({ id, kind: 'PHOTO', origin: 'GMAIL',
  discardedAt: null, storageKey: id, gmailMessageId: 'mail', ...overrides } as ProcedureMaterial);
const jpeg = (width = 400, height = 300, background = 'white') => sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer();
const response = (probability: unknown) => new Response(JSON.stringify({ answers: { boundary: { probabilities: { new_document: probability } } } }), { status: 200 });
async function harness(rows = [photo('a'), photo('b')], options: { enabled?: boolean; key?: string | null; timeoutMs?: number } = {}) {
  const bytes = await jpeg();
  const read = vi.fn().mockResolvedValue(bytes);
  const findMany = vi.fn().mockResolvedValue(rows);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(0.7));
  let now = 0;
  const service = new ProcedureMaterialSplitSuggestionService({ db: { procedureMaterial: { findMany } } as never,
    store: { read }, fetch, enabled: () => options.enabled ?? true, apiKey: () => options.key === null ? undefined : options.key ?? 'fake-typesafe-key-1234',
    timeoutMs: options.timeoutMs ?? 1000, now: () => now });
  return { service, fetch, read, findMany, advance: (ms: number) => { now += ms; } };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('procedure material split suggestions', () => {
  it('pins the model, matches the eval request, and preserves input rather than database order', async () => {
    const { service, fetch, read } = await harness([photo('b'), photo('a')]);
    expect(await service.suggest(['a', 'b'])).toEqual({ status: 'ok', boundaries: [{ beforeId: 'b', afterId: 'a', probability: 0.7 }] });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer fake-typesafe-key-1234', 'TypeSafe-Danger-Zone-Images': 'true' } });
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state).toEqual({ prev_page: 'page-a', next_page: 'page-b' });
    expect(body.questions.boundary).toMatchObject({ type: 'choice', criteria: { continuation: expect.any(String), new_document: expect.any(String) } });
    for (const [key, asset] of Object.entries(body.assets)) {
      expect(Object.values(body.state).filter(value => value === key)).toHaveLength(1);
      expect(asset).toMatchObject({ type: 'image', format: 'jpeg', data_base64: expect.any(String) });
    }
    expect(read).toHaveBeenCalledWith('a', { verifyIntegrity: true });
  });
  it.each([0, 0.499, 0.5, 1])('uses the inclusive 0.5 threshold: %s', async probability => {
    const { service, fetch } = await harness(); fetch.mockResolvedValue(response(probability));
    const result = await service.suggest(['a', 'b']);
    expect(result.status).toBe('ok'); expect(result.boundaries).toHaveLength(probability >= 0.5 ? 1 : 0);
  });
  it.each([
    { kind: 'PDF' }, { kind: 'TEXT' }, { origin: 'KNOWLEDGE' }, { origin: 'WORK_INSTRUCTION' },
    { gmailMessageId: 'other' }, { gmailMessageId: null }, { discardedAt: new Date() }, { storageKey: null },
  ] satisfies Partial<ProcedureMaterial>[])('never sends ineligible pairs %j in either direction', async override => {
    for (const rows of [[photo('a', override), photo('b')], [photo('a'), photo('b', override)]]) {
      const { service, fetch, read } = await harness(rows);
      expect((await service.suggest(['a', 'b'])).boundaries).toEqual([]);
      expect(fetch).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    }
  });
  it('does not bridge missing or non-photo pages', async () => {
    const { service, fetch } = await harness([photo('a'), photo('c')]);
    await service.suggest(['a', 'missing', 'c']); expect(fetch).not.toHaveBeenCalled();
  });
  it('rotates and resizes a 4000x3000 original to a JPEG no larger than 1568', async () => {
    const { service, fetch, read } = await harness();
    read.mockResolvedValue(await sharp(await jpeg(4000, 3000)).withMetadata({ orientation: 6 }).toBuffer());
    await service.suggest(['a', 'b']);
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(await sharp(Buffer.from(body.assets['page-a'].data_base64, 'base64')).metadata()).toMatchObject({ format: 'jpeg', width: 1176, height: 1568 });
  });
  it.each([[255, 400], [256, 300], [100, 100]])('skips images outside the minimum dimensions/pixels %s x %s', async (width, height) => {
    const { service, fetch, read } = await harness(); read.mockResolvedValue(await jpeg(width, height));
    expect((await service.suggest(['a', 'b'])).boundaries).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ enabled: false }, { key: null }, { key: '' }, { key: 'short' }])('is disabled without both opt-in and a key: %j', async options => {
    const { service, fetch, findMany } = await harness(undefined, options);
    expect(await service.suggest(['a', 'b'])).toEqual({ status: 'disabled', boundaries: [] });
    expect(fetch).not.toHaveBeenCalled(); expect(findMany).not.toHaveBeenCalled();
  });
  it('caches successful continuations too and expires after seven days with the injected clock', async () => {
    const { service, fetch, advance } = await harness(); fetch.mockImplementation(async () => response(0.1));
    await service.suggest(['a', 'b']); await service.suggest(['a', 'b']); expect(fetch).toHaveBeenCalledOnce();
    advance(7 * 24 * 60 * 60_000);
    await service.suggest(['a', 'b']); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([null, '0.9', -1, 1.1])('does not cache invalid probabilities %s', async probability => {
    const { service, fetch } = await harness(); fetch.mockImplementation(async () => response(probability));
    for (let attempt = 0; attempt < 2; attempt++) expect(await service.suggest(['a', 'b'])).toEqual({ status: 'unavailable', boundaries: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('returns unavailable on HTTP, decoding, storage and database failures without throwing', async () => {
    const { service, fetch, read, findMany } = await harness();
    fetch.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('invalid JSON'));
    for (let i = 0; i < 2; i++) expect((await service.suggest(['a', 'b'])).status).toBe('unavailable');
    read.mockRejectedValueOnce(new Error('read failed'));
    expect((await service.suggest(['a', 'b'])).status).toBe('unavailable');
    findMany.mockRejectedValueOnce(new Error('database failed'));
    expect((await service.suggest(['a', 'b'])).status).toBe('unavailable');
  });
  it('aborts fetch at the overall deadline even when fetch ignores its signal', async () => {
    const { service, fetch } = await harness();
    let sent!: () => void; const started = new Promise<void>(resolve => { sent = resolve; });
    fetch.mockImplementation(() => { sent(); return new Promise(() => {}); });
    vi.useFakeTimers();
    const result = service.suggest(['a', 'b']); await started;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ status: 'unavailable', boundaries: [] });
    expect(fetch.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
  it('keeps a successful boundary when another pair reaches the overall timeout', async () => {
    const { service, fetch, read } = await harness([photo('a'), photo('b'), photo('c')]);
    const bytes = await Promise.all(['red', 'blue', 'green'].map(color => jpeg(400, 300, color)));
    read.mockImplementation(async key => bytes[['a', 'b', 'c'].indexOf(key)]);
    fetch.mockImplementationOnce(async () => response(0.9)).mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const result = service.suggest(['a', 'b', 'c']);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ status: 'ok', boundaries: [{ probability: 0.9 }] });
  });
  it('bounds a response body that stalls after HTTP success', async () => {
    const { service, fetch } = await harness();
    let reading!: () => void; const started = new Promise<void>(resolve => { reading = resolve; });
    fetch.mockResolvedValue({ ok: true, json: () => { reading(); return new Promise(() => {}); } } as Response);
    vi.useFakeTimers(); const result = service.suggest(['a', 'b']); await started;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ status: 'unavailable', boundaries: [] });
  });
  it('skips a prepared JPEG over 16 MiB', async () => {
    const { service, fetch } = await harness();
    vi.spyOn(sharp.prototype, 'toBuffer').mockResolvedValue({ data: Buffer.alloc(16 * 1024 * 1024 + 1), info: { width: 1568, height: 1568 } } as never);
    expect((await service.suggest(['a', 'b'])).boundaries).toEqual([]); expect(fetch).not.toHaveBeenCalled();
  });
  it('also bounds the initial database load', async () => {
    const { service, findMany, fetch } = await harness(); findMany.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers(); const result = service.suggest(['a', 'b']); await vi.advanceTimersByTimeAsync(1000);
    expect((await result).status).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled();
  });
  it('retains successful boundaries on partial failure and caps concurrency at three', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => photo(String(index)));
    const { service, fetch, read } = await harness(rows);
    const bytes = await Promise.all(rows.map((_, index) => jpeg(400, 300, `rgb(${index * 20},0,0)`)));
    read.mockImplementation(async key => bytes[Number(key)]);
    let active = 0; let maxActive = 0;
    const pending: Array<(response: Response) => void> = [];
    fetch.mockImplementation(() => { active++; maxActive = Math.max(maxActive, active); return new Promise<Response>(resolve => pending.push(value => { active--; resolve(value); })); });
    const result = service.suggest(rows.map(row => row.id));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    pending[0](response(0.9)); pending[1](new Response('', { status: 500 })); pending[2](response(0.1));
    await vi.waitFor(() => expect(pending).toHaveLength(5));
    pending[3](response(0.8)); pending[4](response(0.2));
    const finished = await result;
    expect(finished.status).toBe('ok'); expect(finished.boundaries).toHaveLength(2); expect(maxActive).toBe(3);
  });
});
