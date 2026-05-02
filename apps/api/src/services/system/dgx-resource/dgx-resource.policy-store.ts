import { randomUUID } from 'node:crypto';

/** 運用モード（管理UIから切替）。プロセス存続のみ（再起動で既定に戻る）。 */
export type DgxPolicyMode = 'business_first' | 'private_ok' | 'experiment_first';

export type DgxResourceEvent = {
  id: string;
  at: string;
  message: string;
};

export class DgxResourcePolicyStore {
  private policyMode: DgxPolicyMode = 'business_first';

  /** 直前のモード（GUI ロールバック用。初回切替前は null） */
  private previousPolicyMode: DgxPolicyMode | null = null;

  private readonly events: DgxResourceEvent[] = [];

  constructor(private readonly maxEvents: number) {}

  getPolicyMode(): DgxPolicyMode {
    return this.policyMode;
  }

  getPreviousPolicyMode(): DgxPolicyMode | null {
    return this.previousPolicyMode;
  }

  setPolicyMode(mode: DgxPolicyMode): boolean {
    if (mode === this.policyMode) return false;
    this.previousPolicyMode = this.policyMode;
    this.policyMode = mode;
    return true;
  }

  appendEvent(message: string): void {
    this.events.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      message,
    });
    if (this.events.length > this.maxEvents) {
      this.events.length = this.maxEvents;
    }
  }

  getEvents(limit: number): DgxResourceEvent[] {
    return this.events.slice(0, Math.min(limit, this.maxEvents));
  }
}

let singleton: DgxResourcePolicyStore | null = null;

export function getDgxResourcePolicyStore(maxEvents: number): DgxResourcePolicyStore {
  if (!singleton) {
    singleton = new DgxResourcePolicyStore(maxEvents);
  }
  return singleton;
}

/** @internal テスト用 */
export function resetDgxResourcePolicyStoreForTests(): void {
  singleton = null;
}
