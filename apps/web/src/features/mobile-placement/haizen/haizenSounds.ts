import { playTone, resumeToneContext } from '../../../utils/audioTone';

import type { Tone } from '../../../utils/audioTone';

export type HaizenSound = 'tap' | 'decide' | 'ok' | 'ng';

const SOUNDS: Record<HaizenSound, Tone[]> = {
  tap: [{ freq: 1400, dur: 0.035, peak: 0.18, type: 'triangle' }],
  decide: [{ freq: 1760, dur: 0.09, peak: 0.22, type: 'sine' }],
  ok: [{ freq: 1319, dur: 0.18, peak: 0.3, type: 'sine' }, { freq: 1047, start: 0.16, dur: 0.32, peak: 0.3, type: 'sine' }],
  ng: [{ freq: 196, dur: 0.16, peak: 0.12, type: 'square' }, { freq: 196, start: 0.2, dur: 0.34, peak: 0.12, type: 'square' }]
};

export function unlockHaizenSound(): void {
  try { resumeToneContext(); } catch { /* 音の失敗は画面に影響させない */ }
}

export function playHaizenSound(kind: HaizenSound): void {
  try { SOUNDS[kind].forEach(playTone); } catch { /* 音の失敗は画面に影響させない */ }
}
