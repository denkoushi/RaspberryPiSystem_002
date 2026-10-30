export type CameraFrame = { bytes: Buffer; capturedAt: Date; saved?: boolean };
export type Judgement = 'person' | 'unjudged';
type DeviceState = {
  ring: CameraFrame[]; lastJudgedAt: number; postRemaining: number;
  lastUnjudgedSavedAt: number; processing: boolean;
};

export function parsePersonResponse(rawText: string, minConfidence = 0.5): boolean {
  const value: unknown = JSON.parse(rawText);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 2 || !('person' in value) || typeof value.person !== 'boolean'
    || !('confidence' in value) || typeof value.confidence !== 'number'
    || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('Invalid person judgement');
  }
  return value.person && value.confidence >= minConfidence;
}

export class WatchCameraProcessor {
  private readonly devices = new Map<string, DeviceState>();
  private judging = false;

  constructor(private readonly deps: {
    now: () => Date;
    judgeIntervalMs: number;
    unjudgedIntervalMs: number;
    judge: (bytes: Buffer) => Promise<boolean>;
    save: (deviceId: string, frame: CameraFrame, judgement: Judgement) => Promise<boolean>;
  }) {}

  async receive(deviceId: string, bytes: Buffer): Promise<void> {
    let state = this.devices.get(deviceId);
    if (!state) {
      state = { ring: [], lastJudgedAt: -Infinity, postRemaining: 0, lastUnjudgedSavedAt: -Infinity, processing: false };
      this.devices.set(deviceId, state);
    }
    if (state.processing) return;
    state.processing = true;
    const frame: CameraFrame = { bytes, capturedAt: this.deps.now() };
    const now = frame.capturedAt.getTime();
    const save = async (item: CameraFrame, judgement: Judgement) => {
      if (!item.saved) item.saved = await this.deps.save(deviceId, item, judgement);
      return item.saved;
    };
    try {
      if (state.postRemaining > 0) {
        await save(frame, 'person');
        state.postRemaining -= 1;
      } else if (now - state.lastJudgedAt >= this.deps.judgeIntervalMs) {
        state.lastJudgedAt = now;
        let person: boolean | undefined;
        // Busy inference is a failed judgement; never queue another DGX call.
        if (!this.judging) {
          this.judging = true;
          try { person = await this.deps.judge(bytes); }
          catch { /* Failed inference uses the unjudged fallback. */ }
          finally { this.judging = false; }
        }
        if (person === true) {
          for (const previous of state.ring) await save(previous, 'person');
          await save(frame, 'person');
          state.postRemaining = 3;
        } else if (person === undefined && now - state.lastUnjudgedSavedAt >= this.deps.unjudgedIntervalMs) {
          if (await save(frame, 'unjudged')) state.lastUnjudgedSavedAt = now;
        }
      }
      state.ring.push(frame);
      if (state.ring.length > 3) state.ring.shift();
    } finally {
      state.processing = false;
    }
  }
}

export class WatchCameraCapacity {
  private total = 0;
  private refreshedAt = -Infinity;
  private refreshing: Promise<void> | undefined;
  private lastWarningAt = -Infinity;

  constructor(private readonly deps: {
    now: () => number; maxBytes: number; aggregate: () => Promise<number>; warn: (message: string) => void;
  }) {}

  async reserve(bytes: number): Promise<boolean> {
    const now = this.deps.now();
    if (now - this.refreshedAt >= 60_000) {
      this.refreshing ??= this.deps.aggregate().then((total) => {
        this.total = total; this.refreshedAt = now;
      }).finally(() => { this.refreshing = undefined; });
      await this.refreshing;
    }
    const full = this.total >= this.deps.maxBytes || this.total + bytes > this.deps.maxBytes;
    if ((full || this.total + bytes > this.deps.maxBytes * 0.8) && now - this.lastWarningAt >= 3600_000) {
      this.deps.warn(full ? 'Watch camera capacity limit reached' : 'Watch camera capacity exceeds 80%');
      this.lastWarningAt = now;
    }
    if (full) return false;
    this.total += bytes;
    return true;
  }

  release(bytes: number): void { this.total -= bytes; }
}
