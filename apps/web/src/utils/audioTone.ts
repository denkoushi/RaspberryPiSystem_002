let sharedContext: AudioContext | null = null;

/** One AudioContext for short UI tones; null where Web Audio is unavailable. */
export function getToneContext(): AudioContext | null {
  if (sharedContext) return sharedContext;
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  sharedContext = new Ctor();
  return sharedContext;
}

/** Resume a suspended context; call from a user gesture so later tones can play. */
export function resumeToneContext(): AudioContext | null {
  const context = getToneContext();
  if (context?.state === 'suspended') void context.resume();
  return context;
}

export type Tone = { freq: number; start?: number; dur: number; peak: number; type: OscillatorType; attack?: number };

/** Play one note with a fast attack and an exponential fade. */
export function playTone({ freq, start = 0, dur, peak, type, attack = 0.005 }: Tone): void {
  const context = resumeToneContext();
  if (!context) return;
  const t = context.currentTime + start;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(t);
  oscillator.stop(t + dur + 0.02);
}
