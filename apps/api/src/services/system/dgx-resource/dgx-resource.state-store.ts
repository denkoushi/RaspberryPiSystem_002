import { randomUUID } from 'node:crypto';

export type DgxResourceEvent = { id: string; at: string; message: string };
export type BusinessReturn = {
  state: 'idle' | 'in_progress' | 'succeeded' | 'failed';
  phase: 'starting' | 'checking' | null;
  profileId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  failureReasonJa: string | null;
};

/** Shared by route service instances; survives navigation, not API process restart. */
export class DgxResourceStateStore {
  private busy = false;
  private businessReturn: BusinessReturn = {
    state: 'idle', phase: null, profileId: null, startedAt: null, finishedAt: null, failureReasonJa: null,
  };
  private readonly events: DgxResourceEvent[] = [];

  constructor(private readonly maxEvents: number) {}

  tryAcquire(): boolean {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }

  release(): void { this.busy = false; }

  getBusinessReturn(): BusinessReturn { return { ...this.businessReturn }; }

  startReturn(profileId: string): BusinessReturn {
    this.businessReturn = {
      state: 'in_progress', phase: 'starting', profileId, startedAt: new Date().toISOString(), finishedAt: null, failureReasonJa: null,
    };
    return this.getBusinessReturn();
  }

  setReturnPhase(phase: 'starting' | 'checking'): void {
    if (this.businessReturn.state === 'in_progress') this.businessReturn.phase = phase;
  }

  finishReturn(failureReasonJa: string | null): void {
    this.businessReturn = {
      ...this.businessReturn, phase: null, state: failureReasonJa ? 'failed' : 'succeeded',
      finishedAt: new Date().toISOString(), failureReasonJa,
    };
  }

  appendEvent(message: string): void {
    this.events.unshift({ id: randomUUID(), at: new Date().toISOString(), message });
    this.events.length = Math.min(this.events.length, this.maxEvents);
  }

  getEvents(limit: number): DgxResourceEvent[] {
    return this.events.slice(0, Math.max(0, Math.min(limit, this.maxEvents))).map((event) => ({ ...event }));
  }
}

let singleton: DgxResourceStateStore | undefined;
export function getDgxResourceStateStore(maxEvents: number): DgxResourceStateStore {
  singleton ??= new DgxResourceStateStore(maxEvents);
  return singleton;
}
