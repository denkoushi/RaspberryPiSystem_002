import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../../../config/env.js';
import {
  getBusinessProfileIntentStore,
  resetBusinessProfileIntentStoreForTests,
} from '../business-profile-intent-store.js';

const originalFilePath = env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH;
let tempDir = '';

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'business-profile-intent-'));
});

afterEach(() => {
  env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH = originalFilePath;
  resetBusinessProfileIntentStoreForTests();
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('BusinessProfileIntentStore persistence', () => {
  it('uses memory only when env path is unset', () => {
    env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH = undefined;
    const store = getBusinessProfileIntentStore();

    store.setFromOrchestration('business_qwen36_27b_nvfp4');

    expect(store.getModelProfileId()).toBe('business_qwen36_27b_nvfp4');
    expect(existsSync(join(tempDir, 'intent.json'))).toBe(false);
  });

  it('writes on setFromOrchestration and reloads after reset', () => {
    const filePath = join(tempDir, 'intent.json');
    env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH = filePath;

    const store = getBusinessProfileIntentStore();
    store.setFromOrchestration('business_qwen35_35b_gguf');

    expect(existsSync(filePath)).toBe(true);
    const persisted = JSON.parse(readFileSync(filePath, 'utf8')) as {
      modelProfileId: string;
      source: string;
    };
    expect(persisted.modelProfileId).toBe('business_qwen35_35b_gguf');
    expect(persisted.source).toBe('orchestration');

    resetBusinessProfileIntentStoreForTests();
    const reloaded = getBusinessProfileIntentStore();
    expect(reloaded.getModelProfileId()).toBe('business_qwen35_35b_gguf');
  });

  it('ignores corrupt file and starts empty', () => {
    const filePath = join(tempDir, 'intent.json');
    writeFileSync(filePath, '{not-json', 'utf8');
    env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH = filePath;

    const store = getBusinessProfileIntentStore();
    expect(store.get()).toBeNull();
  });

  it('ignores invalid record shape', () => {
    const filePath = join(tempDir, 'intent.json');
    writeFileSync(
      filePath,
      JSON.stringify({ modelProfileId: '', source: 'orchestration', updatedAt: '2026-01-01T00:00:00.000Z' }),
      'utf8'
    );
    env.INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH = filePath;

    const store = getBusinessProfileIntentStore();
    expect(store.get()).toBeNull();
  });
});
