import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

/**
 * 業務用 modelProfileId の Pi5 側意図（プロセス内、任意でファイル永続化）。
 * DGX active state の正本は変えず、on-demand /start に載せる意図を保持する。
 */

const log = logger.child({ component: 'businessProfileIntentStore' });

/** runtime /start 意図に使うのは orchestration のみ（env は resolver が直接読む） */
export type BusinessProfileIntentSource = 'orchestration';

export type BusinessProfileIntentRecord = {
  modelProfileId: string;
  source: BusinessProfileIntentSource;
  updatedAt: string;
};

function isValidBusinessProfileIntentRecord(value: unknown): value is BusinessProfileIntentRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.modelProfileId === 'string' &&
    record.modelProfileId.trim().length > 0 &&
    record.source === 'orchestration' &&
    typeof record.updatedAt === 'string'
  );
}

function loadRecordFromFile(filePath: string): BusinessProfileIntentRecord | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidBusinessProfileIntentRecord(parsed)) {
      log.warn({ filePath }, 'Ignoring invalid business profile intent file');
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to load business profile intent file');
    return null;
  }
}

function persistRecordToFile(filePath: string, record: BusinessProfileIntentRecord): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(record), 'utf8');
  } catch (err) {
    log.warn({ err, filePath }, 'Failed to persist business profile intent file');
  }
}

export class BusinessProfileIntentStore {
  private record: BusinessProfileIntentRecord | null;
  private readonly filePath?: string;

  constructor(filePath?: string) {
    this.filePath = filePath?.trim() || undefined;
    this.record = this.filePath ? loadRecordFromFile(this.filePath) : null;
  }

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
    if (this.filePath) {
      persistRecordToFile(this.filePath, this.record);
    }
  }

  clearForTests(): void {
    this.record = null;
  }
}

let singleton: BusinessProfileIntentStore | null = null;

export function getBusinessProfileIntentStore(): BusinessProfileIntentStore {
  if (!singleton) {
    singleton = new BusinessProfileIntentStore(env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH);
  }
  return singleton;
}

/** @internal テスト用 */
export function resetBusinessProfileIntentStoreForTests(): void {
  singleton = null;
}
