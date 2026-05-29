/**
 * 業務用 modelProfileId の Pi5 側意図（プロセス内）。
 * DGX active state の正本は変えず、on-demand /start に載せる意図を保持する。
 */

/** runtime /start 意図に使うのは orchestration のみ（env は resolver が直接読む） */
export type BusinessProfileIntentSource = 'orchestration';

export type BusinessProfileIntentRecord = {
  modelProfileId: string;
  source: BusinessProfileIntentSource;
  updatedAt: string;
};

export class BusinessProfileIntentStore {
  private record: BusinessProfileIntentRecord | null = null;

  get(): BusinessProfileIntentRecord | null {
    return this.record;
  }

  getModelProfileId(): string | undefined {
    return this.record?.modelProfileId.trim() || undefined;
  }

  setFromOrchestration(modelProfileId: string): void {
    this.record = {
      modelProfileId: modelProfileId.trim(),
      source: 'orchestration',
      updatedAt: new Date().toISOString(),
    };
  }

  clearForTests(): void {
    this.record = null;
  }
}

let singleton: BusinessProfileIntentStore | null = null;

export function getBusinessProfileIntentStore(): BusinessProfileIntentStore {
  if (!singleton) {
    singleton = new BusinessProfileIntentStore();
  }
  return singleton;
}

/** @internal テスト用 */
export function resetBusinessProfileIntentStoreForTests(): void {
  singleton = null;
}
