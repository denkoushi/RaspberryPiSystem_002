import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({ env: {} }));
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../lib/part-measurement-drawing-storage.js', () => ({ PartMeasurementDrawingStorage: {} }));

import {
  createPlacementJevReorderProvider, cropTransferDrawing, formatTransferNominal, TRANSFER_JEV_INSTRUCTIONS
} from './part-measurement-drawing-placement-jev-reorder.js';
import type { PlacementCandidate, PlacementSourceItem } from './part-measurement-drawing-placement-transfer.js';

const item: PlacementSourceItem = {
  id: 'item', sortOrder: 1, measurementLabel: '長さ', nominalValue: 10,
  lowerLimit: null, upperLimit: null, valueKind: 'NUMERIC', depthMode: 'MEASURED',
  markerXRatio: 0.5, markerYRatio: 0.5, calloutTipXRatio: null, calloutTipYRatio: null
};
const candidates: PlacementCandidate[] = [0.5, 0.7].map((xRatio, i) => ({
  text: '10', xRatio, yRatio: 0.5, kind: 'len', distance: i / 5
}));
const context = { sourceVisualTemplateId: 'source', sourceMap: null };
let image: Buffer;
beforeAll(async () => { image = await sharp({ create: { width: 1000, height: 600, channels: 3, background: 'white' } }).png().toBuffer(); });
afterEach(() => { vi.useRealTimers(); });
const response = (probabilities = { c1: 0.1, c2: 0.3, none: 0.6 }) => new Response(JSON.stringify({ answers: { q: { probabilities } } }));
function setup(overrides = {}) {
  const deps = { enabled: true, apiKey: 'test-placeholder', timeoutMs: 20000,
    readDrawing: vi.fn(async () => image), fetch: vi.fn(async () => response()), ...overrides };
  const provider = createPlacementJevReorderProvider(deps);
  return { deps, provider, reorder: provider?.('target', context) };
}

describe('transfer JEV choice', () => {
  it('ports the evaluation request and ranks candidate probabilities, ignoring none and choice', async () => {
    const { deps, reorder } = setup();
    const ranked = await reorder!(item, candidates);
    expect(ranked).toEqual([{ ...candidates[1], score: 0.3 }, { ...candidates[0], score: 0.1 }]);
    expect(candidates.every((candidate) => candidate.score === undefined)).toBe(true);
    expect(deps.readDrawing.mock.calls).toEqual([['source'], ['target']]);
    const [url, init] = deps.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Authorization: 'Bearer test-placeholder', Accept: 'application/json',
      'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state).toEqual({ item: '項目名「長さ」 基準値 10', source_detail: 'image-0' });
    expect(body.questions).toEqual({ q: { type: 'choice', instructions: TRANSFER_JEV_INSTRUCTIONS, criteria: {
      c1: '新しい図面の候補1: image-1', c2: '新しい図面の候補2: image-2',
      none: 'どの候補も、元の図面の赤丸の寸法と同じ箇所の寸法ではない'
    } } });
    expect(Object.keys(body.assets)).toHaveLength(3);
    for (const asset of Object.values(body.assets) as Array<{ type: string; format: string; data_base64: string }>) {
      expect(asset).toMatchObject({ type: 'image', format: 'jpeg' });
      // eslint-disable-next-line no-await-in-loop
      expect(await sharp(Buffer.from(asset.data_base64, 'base64')).metadata()).toMatchObject({ width: 640, height: 640, format: 'jpeg' });
    }
    const source = Buffer.from(body.assets['image-0'].data_base64, 'base64');
    const target = Buffer.from(body.assets['image-1'].data_base64, 'base64');
    expect(source.equals(await cropTransferDrawing(image, { xRatio: 0.5, yRatio: 0.5 }, { xRatio: 0.5, yRatio: 0.5 }))).toBe(true);
    expect(target.equals(await cropTransferDrawing(image, candidates[0]))).toBe(true);
  });

  it('centres the source on its own dimension nearest the callout tip, regardless of kind', async () => {
    const { provider, deps } = setup();
    const sourceMap = { image: { width: 1000, height: 600 }, dimensions: [{
      text: '10', nominal: 10, upperTolerance: null, lowerTolerance: null, kind: 'other' as const,
      depth: null, xRatio: 0.3, yRatio: 0.4, tileId: 'tile'
    }] };
    const reorder = await provider!('target', { sourceVisualTemplateId: 'source', sourceMap });
    await reorder!({ ...item, calloutTipXRatio: 0.31, calloutTipYRatio: 0.4 }, candidates);
    const body = JSON.parse((deps.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const expected = await cropTransferDrawing(image, sourceMap.dimensions[0], { xRatio: 0.5, yRatio: 0.5 });
    expect(body.assets['image-0'].data_base64).toBe(expected.toString('base64'));
  });

  it.each([
    ['HTTP failure', () => new Response('', { status: 500 })],
    ['bad JSON', () => new Response('not json')],
    ['missing answer', () => new Response('{}')],
    ['missing candidate', () => response({ c1: 0.1, none: 0.9 } as never)],
    ['string probability', () => response({ c1: '0.1', c2: 0.3, none: 0.6 } as never)],
    ['negative probability', () => response({ c1: -0.1, c2: 0.5, none: 0.6 })],
    ['out of range', () => response({ c1: 1.1, c2: 0.5, none: 0.6 })],
    ['array probabilities', () => response([] as never)]
  ])('retains the exact position order on %s', async (_name, result) => {
    const { reorder } = setup({ fetch: vi.fn(async () => result()) });
    expect(await reorder!(item, candidates)).toBe(candidates);
  });

  it('falls back when drawing reads fail', async () => {
    const { reorder, deps } = setup({ readDrawing: vi.fn().mockRejectedValue(new Error('unavailable')) });
    expect(await reorder!(item, candidates)).toBe(candidates);
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('times out, aborts the request and retains position order even if fetch ignores cancellation', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const { reorder } = setup({ timeoutMs: 20, fetch: fetchMock });
    expect(await reorder!(item, candidates)).toBe(candidates);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it.each([{ enabled: false }, { apiKey: undefined }, { apiKey: '  ' }])('disables the provider for %j', async (settings) => {
    const { provider, deps } = setup(settings);
    expect(provider).toBeNull();
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.readDrawing).not.toHaveBeenCalled();
  });

  it('skips zero and one candidate without loading images', async () => {
    const { reorder, deps } = setup();
    expect(await reorder!(item, [])).toEqual([]);
    expect(await reorder!(item, candidates.slice(0, 1))).toEqual(candidates.slice(0, 1));
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.readDrawing).not.toHaveBeenCalled();
  });

  it('evaluates only eight candidates, retaining the tail in position order and stable probability ties', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...candidates[0], distance: i, xRatio: 0.1 + i * 0.08 }));
    const probabilities = Object.fromEntries([...many.slice(0, 8).map((_, i) => [`c${i + 1}`, i === 7 ? 0.3 : 0.1]), ['none', 0]]);
    const { reorder, deps } = setup({ fetch: vi.fn(async () => response(probabilities as never)) });
    const ranked = await reorder!(item, many);
    expect(ranked.map((candidate) => candidate.distance)).toEqual([7, 0, 1, 2, 3, 4, 5, 6, 8, 9]);
    expect(ranked.slice(8)).toEqual(many.slice(8));
    const body = JSON.parse((deps.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body.assets)).toHaveLength(9);
    expect(Object.keys(body.questions.q.criteria)).toHaveLength(9);
  });

  it('shares the 40-call budget and three in-flight slots across drawings, including failures', async () => {
    // Each request is held until released, so the in-flight count does not depend on crop or timer speed.
    let maximum = 0;
    const held: Array<() => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      held.push(() => resolve(new Response('', { status: 503 })));
      maximum = Math.max(maximum, held.length);
    }));
    const { provider } = setup({ fetch: fetchMock });
    const a = await provider!('a', context);
    const b = await provider!('b', context);
    const all = Promise.all(Array.from({ length: 45 }, (_, i) => (i % 2 ? a! : b!)(item, candidates)));
    await vi.waitFor(() => expect(held).toHaveLength(3), { timeout: 10000, interval: 1 });
    // With every slot held, no fourth request may start. A slow machine can only miss an extra slot here, never fail.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(held).toHaveLength(3);
    for (let released = 0; released < 40; released++) {
      // eslint-disable-next-line no-await-in-loop
      await vi.waitFor(() => expect(held.length).toBe(Math.min(3, 40 - released)), { timeout: 10000, interval: 1 });
      held.shift()!();
    }
    const results = await all;
    expect(results.every((result) => result === candidates)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(40);
    expect(maximum).toBe(3);
  });
});

describe('evaluation crop and nominal formatting', () => {
  it('pads a near-edge crop white and renders a 640 square JPEG with a red ring and optional blue marker', async () => {
    const black = await sharp({ create: { width: 1000, height: 600, channels: 3, background: 'black' } }).png().toBuffer();
    const crop = await cropTransferDrawing(black, { xRatio: 0.005, yRatio: 0.005 }, { xRatio: 0.005, yRatio: 0.005 });
    expect(await sharp(crop).metadata()).toMatchObject({ width: 640, height: 640, format: 'jpeg' });
    const pixels = await sharp(crop).removeAlpha().raw().toBuffer();
    const pixel = (x: number, y: number) => [...pixels.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)];
    expect(pixel(0, 0).every((channel) => channel >= 250)).toBe(true);
    expect(pixel(600, 600).every((channel) => channel <= 5)).toBe(true);
    const blue = pixel(320, 320);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(20);
    const red = pixel(402, 320);
    expect(red[0]).toBeGreaterThan(180);
    expect(red[2]).toBeLessThan(70);
  });

  it.each([[10, '10'], [10.1234567, '10.1235'], [0.0001, '0.0001'], [0.00001, '1e-05'],
    [1000000, '1e+06'], [999999.9, '1e+06'], [-12.5, '-12.5'], [0, '0'], [-0, '-0']])('formats %s like Python %%g', (value, expected) => {
    expect(formatTransferNominal(value as number)).toBe(expected);
  });
});
