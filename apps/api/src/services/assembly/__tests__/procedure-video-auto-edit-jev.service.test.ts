import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcedureVideoAutoEditJevService } from '../procedure-video-auto-edit-jev.service.js';
import type { AutoEditSuggestion } from '../procedure-video-auto-edit.js';

const directories: string[] = [];
async function harness(probability = 0.2) {
  const directory = await mkdtemp(path.join(tmpdir(), 'procedure-video-jev-test-')); directories.push(directory);
  const jpeg = await sharp({ create: { width: 100, height: 60, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const transcoder = { posterAt: vi.fn(async (_input, poster, _time) => { await writeFile(poster, jpeg); }) };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify({ answers: { caption: { probabilities: { proposed: probability } } } })));
  const deps = { enabled: () => true, apiKey: () => 'test-api-key', transcoder, fetch };
  const suggestion: AutoEditSuggestion = { scenes: [{ title: '場面', startSeconds: 14.5, endSeconds: 35.9, caption: '棒が下がる' }], comments: [{ atSeconds: 14.5, text: '棒が下がる' }] };
  return { directory, transcoder, fetch, deps, suggestion, service: new ProcedureVideoAutoEditJevService(deps) };
}
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
describe('procedure-video JEV verification', () => {
  it('only marks low-probability captions for review and sends three interior images with shortest edge >=256', async () => {
    const h = await harness(); const result = await h.service.verify(h.suggestion, 'video.mp4', h.directory);
    expect(result.scenes[0]).toMatchObject({ status: 'ok', probability: 0.2 });
    expect(h.suggestion.scenes[0]).toMatchObject({ caption: '棒が下がる', needsReview: true });
    expect(h.suggestion.comments[0].text).toBe('棒が下がる'); expect(h.fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(h.fetch.mock.calls[0][1]!.body as string);
    expect(request.questions.caption.criteria).toEqual({ proposed: '棒が下がる', no_motion: '動きなし', camera: 'カメラの移動', other: 'その他の作業' });
    expect(h.transcoder.posterAt.mock.calls.map((call) => call[2])).toEqual([14.6, 25.2, 35.8]);
    for (const asset of Object.values(request.assets) as any[]) {
      const meta = await sharp(Buffer.from(asset.data_base64, 'base64')).metadata();
      expect(Math.min(meta.width!, meta.height!)).toBeGreaterThanOrEqual(256);
    }
  });
  it('does not mark probability >=0.3 for review', async () => {
    const h = await harness(0.3); await h.service.verify(h.suggestion, 'in', h.directory); expect(h.suggestion.scenes[0].needsReview).toBeUndefined();
  });
  it.each(['disabled', 'no-key'])('does not extract or call JEV when %s', async (state) => {
    const h = await harness(); if (state === 'disabled') h.deps.enabled = () => false; else h.deps.apiKey = () => '';
    expect(await h.service.verify(h.suggestion, 'in', h.directory)).toEqual({ status: 'disabled', scenes: [] });
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.transcoder.posterAt).not.toHaveBeenCalled();
  });
  it.each(['http', 'network', 'invalid-probability', 'ffmpeg'])('records unavailable without rewriting the draft on %s failure', async (state) => {
    const h = await harness(state === 'invalid-probability' ? 1.1 : 0.2);
    if (state === 'http') h.fetch.mockResolvedValue(new Response('', { status: 503 }));
    if (state === 'network') h.fetch.mockRejectedValue(new Error('offline'));
    if (state === 'ffmpeg') h.transcoder.posterAt.mockRejectedValue(new Error('ffmpeg failed'));
    const before = structuredClone(h.suggestion);
    expect(await h.service.verify(h.suggestion, 'in', h.directory)).toMatchObject({ status: 'unavailable', scenes: [{ status: 'unavailable' }] });
    expect(h.suggestion).toEqual(before);
  });
  it('makes at most five JEV calls for a video', async () => {
    const h = await harness(0.8); h.suggestion.scenes = Array.from({ length: 7 }, () => ({ ...h.suggestion.scenes[0] }));
    await h.service.verify(h.suggestion, 'in', h.directory); expect(h.fetch).toHaveBeenCalledTimes(5); expect(h.transcoder.posterAt).toHaveBeenCalledTimes(15);
  });
});
