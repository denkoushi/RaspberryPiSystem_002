import { randomUUID } from 'node:crypto';

/** 運用モード（管理UIから切替）。プロセス存続のみ（再起動で既定に戻る）。 */
export type DgxPolicyMode = 'business_first' | 'private_ok' | 'experiment_first';

export type DgxResourceEvent = {
  id: string;
  at: string;
  message: string;
};

export type DgxResourceScenarioFailureSummary = {
  scenarioId: string;
  at: string;
  message: string;
  completedStepOrders: number[];
};

export class DgxResourcePolicyStore {
  private policyMode: DgxPolicyMode = 'business_first';

  /** 直前のモード（GUI ロールバック用。初回切替前は null） */
  private previousPolicyMode: DgxPolicyMode | null = null;

  private readonly events: DgxResourceEvent[] = [];

  private lastScenarioFailure: DgxResourceScenarioFailureSummary | null = null;

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

  recordScenarioFailure(summary: Omit<DgxResourceScenarioFailureSummary, 'at'>): void {
    this.lastScenarioFailure = { ...summary, at: new Date().toISOString() };
  }

  clearScenarioFailure(): void {
    this.lastScenarioFailure = null;
  }

  getLastScenarioFailure(): DgxResourceScenarioFailureSummary | null {
    return this.lastScenarioFailure;
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
