import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { InferenceDeferredError } from '../inference/ports/text-completion.port.js';
import { parseSiblingVisionResponse, prefilterDrawingSiblings, SIBLING_VISION_INSTRUCTIONS } from './part-measurement-drawing-sibling-match.js';
import { selectDrawingSiblings } from './part-measurement-drawing-sibling-selection.js';

const drawing = (id: string, name = '同名') => ({ id, name, drawingImageRelativePath: id });
const rectangle = (width = 60, height = 30, margin = 10) => sharp(Buffer.from(
  `<svg width="${width + margin * 2}" height="${height + margin * 2}"><rect width="100%" height="100%" fill="white"/><rect x="${margin}" y="${margin}" width="${width}" height="${height}" fill="none" stroke="black" stroke-width="2"/></svg>`
)).png().toBuffer();

async function selectionDeps() {
  const readDrawing = vi.fn().mockResolvedValue({ buffer: await rectangle() });
  const completeMany = vi.fn().mockResolvedValue({ rawText: '{"shapeSimilarity":0.9}', model: 'fake' });
  return { readDrawing, completeMany, vision: () => ({ completeMany }), enabled: () => true, candidateLimit: () => 8 };
}

describe('prefilterDrawingSiblings', () => {
  it('ranks shape ahead of names and dimensions, trims margins and limits candidates', async () => {
    const images = new Map([
      ['target', await rectangle()], ['near', await rectangle(120, 60, 30)],
      ['wrong', await rectangle(30, 80)], ['also-near', await rectangle()]
    ]);
    const readDrawing = vi.fn(async (path: string) => {
      const buffer = images.get(path);
      if (!buffer) throw new Error('missing');
      return { buffer };
    });
    const target = { ...drawing('target'), map: { dimensions: [{ nominal: 10 }] } };
    const candidates = [
      { ...drawing('wrong'), map: target.map },
      { ...drawing('near', '別名'), map: { dimensions: [{ nominal: 999 }] } },
      { ...drawing('also-near', '違う名前'), map: { dimensions: [] } },
      { ...drawing('missing'), map: target.map }, target
    ];
    const result = await prefilterDrawingSiblings(target, candidates, { readDrawing, candidateLimit: () => 2 });
    expect(result.map(({ id }) => id).sort()).toEqual(['also-near', 'near']);
    expect(readDrawing.mock.calls.filter(([path]) => path === 'target')).toHaveLength(1);
  });
});

describe('parseSiblingVisionResponse', () => {
  it('accepts plain and fenced JSON', () => {
    const json = '{"shapeSimilarity":0.8}';
    expect(parseSiblingVisionResponse(json)).toEqual({ shapeSimilarity: 0.8 });
    expect(parseSiblingVisionResponse(`\`\`\`json\n${json}\n\`\`\``)).toEqual({ shapeSimilarity: 0.8 });
  });
  it.each(['not json', '{}', '{"shapeSimilarity":1.1}', '{"shapeSimilarity":-0.1}', '{"shapeSimilarity":"0.9"}', '{"shapeSimilarity":null}'])('rejects invalid response %s', (raw) => {
    expect(() => parseSiblingVisionResponse(raw)).toThrow();
  });
});

describe('selectDrawingSiblings', () => {
  it('calls once per candidate with two images, reuses target and sorts scores at or above 0.8', async () => {
    const deps = await selectionDeps();
    for (const score of [0.79, 0.8, 0.95]) deps.completeMany.mockResolvedValueOnce({ rawText: JSON.stringify({ shapeSimilarity: score }) });
    const result = await selectDrawingSiblings(drawing('target'), ['low', 'edge', 'high'].map((id) => drawing(id)), 1, deps);
    expect(result).toMatchObject({ status: 'MATCHED', method: 'dgx-vision', lastError: null, siblings: [
      { visualTemplateId: 'high', confidence: 0.95 }, { visualTemplateId: 'edge', confidence: 0.8 }
    ] });
    expect(deps.completeMany).toHaveBeenCalledTimes(3);
    expect(deps.readDrawing).toHaveBeenCalledTimes(4);
    const requests = deps.completeMany.mock.calls.map(([request]) => request);
    for (const request of requests) {
      expect(request).toMatchObject({ maxTokens: 600, temperature: 0, jsonOutput: true, background: true, timeoutMs: 115_000, userText: SIBLING_VISION_INSTRUCTIONS });
      expect(request.images.map(({ label }: { label: string }) => label)).toEqual(['target', 'candidate_1']);
      expect(request.images[0]).toBe(requests[0].images[0]);
      expect(await sharp(request.images[1].imageBytes).metadata()).toMatchObject({ format: 'jpeg' });
    }
  });
  it.each([1, 3, 10])('returns PENDING on deferred inference even after %s attempts and discards earlier matches', async (attempts) => {
    const deps = await selectionDeps();
    deps.completeMany.mockResolvedValueOnce({ rawText: '{"shapeSimilarity":0.9}' }).mockRejectedValueOnce(new InferenceDeferredError());
    expect(await selectDrawingSiblings(drawing('target'), [drawing('a'), drawing('b')], attempts, deps))
      .toMatchObject({ status: 'PENDING', siblings: [], lastError: 'DGX background admission deferred' });
  });
  it('continues after malformed, missing and failed candidate responses', async () => {
    const deps = await selectionDeps();
    deps.completeMany.mockResolvedValueOnce({ rawText: 'broken' }).mockResolvedValueOnce({ rawText: '{}' })
      .mockRejectedValueOnce(new Error('candidate failure'));
    expect(await selectDrawingSiblings(drawing('target'), ['a', 'b', 'c', 'd'].map((id) => drawing(id)), 1, deps))
      .toMatchObject({ status: 'MATCHED', siblings: [{ visualTemplateId: 'd', confidence: 0.9 }], lastError: 'candidate failure' });
  });
  it.each([1, 2, 3])('does not select same-name candidates when all responses fail on attempt %s', async (attempts) => {
    const deps = await selectionDeps();
    deps.completeMany.mockRejectedValue(new Error('failed'));
    expect(await selectDrawingSiblings(drawing('target'), [drawing('a')], attempts, deps))
      .toMatchObject({ status: attempts < 3 ? 'PENDING' : 'NO_MATCH', siblings: [], lastError: 'failed' });
  });
  it('returns NO_MATCH for a valid low score or disabled inference', async () => {
    const deps = await selectionDeps();
    deps.completeMany.mockResolvedValue({ rawText: '{"shapeSimilarity":0.79}' });
    expect(await selectDrawingSiblings(drawing('target'), [drawing('a')], 1, deps)).toMatchObject({ status: 'NO_MATCH', siblings: [] });
    deps.completeMany.mockClear();
    expect(await selectDrawingSiblings(drawing('target'), [drawing('a')], 1, { ...deps, enabled: () => false }))
      .toMatchObject({ status: 'NO_MATCH', siblings: [] });
    expect(deps.completeMany).not.toHaveBeenCalled();
  });
});
