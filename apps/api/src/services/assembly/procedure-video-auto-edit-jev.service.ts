import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

import type { AutoEditSuggestion } from './procedure-video-auto-edit.js';
import type { ProcedureVideoTranscoderPort } from './procedure-video-transcoder.port.js';

export function autoEditVerificationTimes(start: number, end: number): number[] {
  const inset = Math.min(0.1, (end - start) / 4);
  return [start + inset, (start + end) / 2, end - inset];
}

async function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error('Video verification timed out'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

type Deps = { enabled: () => boolean; apiKey: () => string | undefined; transcoder: Pick<ProcedureVideoTranscoderPort, 'posterAt'>; fetch?: typeof fetch };
export class ProcedureVideoAutoEditJevService {
  constructor(private readonly deps: Deps) {}

  async verify(suggestion: AutoEditSuggestion, input: string, directory: string) {
    const apiKey = this.deps.apiKey();
    if (!this.deps.enabled() || !apiKey) return { status: 'disabled', scenes: [] };
    const scenes: Array<{ index: number; status: string; times: number[]; probability?: number }> = [];
    for (const [index, scene] of suggestion.scenes.slice(0, 5).entries()) {
      const times = autoEditVerificationTimes(scene.startSeconds, scene.endSeconds);
      try {
        const assets: Record<string, { type: string; format: string; data_base64: string }> = {};
        for (const [frameIndex, time] of times.entries()) {
          const file = path.join(directory, `jev-${index}-${frameIndex}.jpg`);
          // Exact timestamps remain inside this scene even for subsecond boundaries.
          // eslint-disable-next-line no-await-in-loop
          await this.deps.transcoder.posterAt(input, file, time);
          // eslint-disable-next-line no-await-in-loop
          const { data, info } = await sharp(await readFile(file)).rotate()
            .resize({ width: 280, height: 280, fit: 'outside' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
          if (Math.min(info.width, info.height) < 256 || info.width * info.height > 2_458_624 || data.length > 16 * 1024 * 1024) throw new Error('Verification image size unsupported');
          assets[`frame${frameIndex}`] = { type: 'image', format: 'jpeg', data_base64: data.toString('base64') };
        }
        const signal = AbortSignal.timeout(20_000);
        const result = await bounded((async () => {
          const response = await (this.deps.fetch ?? globalThis.fetch)('https://api.typesafe.ai/v1/systemone', {
            method: 'POST', signal,
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' },
            body: JSON.stringify({ model: 'jev-1.13.0',
              state: { frames: Object.keys(assets), times }, assets,
              questions: { caption: { type: 'choice', instructions: '時系列の3枚の画像に実際に見える動作を選んでください。道具名や目的は推測しないでください。',
                criteria: { proposed: scene.caption, no_motion: '動きなし', camera: 'カメラの移動', other: 'その他の作業' } } },
            }),
          });
          if (!response.ok) throw new Error('Verification upstream failed');
          return response.json();
        })(), signal);
        const probability: unknown = result?.answers?.caption?.probabilities?.proposed;
        if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid verification probability');
        if (probability < 0.3) scene.needsReview = true;
        scenes.push({ index, status: 'ok', probability, times });
      } catch { scenes.push({ index, status: 'unavailable', times }); }
    }
    return { status: scenes.every((scene) => scene.status === 'ok') ? 'ok' : 'unavailable', scenes };
  }
}
