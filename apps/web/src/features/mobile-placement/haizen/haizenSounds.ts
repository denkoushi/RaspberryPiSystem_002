export type HaizenSound = 'tap' | 'decide' | 'ok' | 'ng';

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function unlockHaizenSound(): void {
  try {
    const c = getContext();
    if (c && c.state === 'suspended') void c.resume();
  } catch {
    /* 音の失敗は画面に影響させない */
  }
}

export function playHaizenSound(kind: HaizenSound): void {
  try {
    const c = getContext();
    if (!c) return;
    if (c.state === 'suspended') void c.resume();
    const note = (freq: number, start: number, dur: number, peak: number, type: OscillatorType) => {
      const t = c.currentTime + start;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };
    if (kind === 'tap') note(1400, 0, 0.035, 0.18, 'triangle');
    else if (kind === 'decide') note(1760, 0, 0.09, 0.22, 'sine');
    else if (kind === 'ok') {
      note(1319, 0, 0.18, 0.3, 'sine');
      note(1047, 0.16, 0.32, 0.3, 'sine');
    } else {
      note(196, 0, 0.16, 0.12, 'square');
      note(196, 0.2, 0.34, 0.12, 'square');
    }
  } catch {
    /* 音の失敗は画面に影響させない */
  }
}
