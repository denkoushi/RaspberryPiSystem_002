import { afterEach, describe, expect, it } from 'vitest';

import { env } from '../../../../config/env.js';
import {
  INFERENCE_PROMPT_DEFAULTS,
  resolveDocumentSummarySystemPrompt,
  resolvePhotoLabelUserPrompt,
  resolveStackChanSystemPrompt,
} from '../inference-prompt-registry.js';

const originalEnv = {
  photoToolLabelUserPrompt: env.PHOTO_TOOL_LABEL_USER_PROMPT,
  documentSummarySystemPrompt: env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT,
  stackchanSystemPrompt: env.INFERENCE_STACKCHAN_SYSTEM_PROMPT,
};

afterEach(() => {
  env.PHOTO_TOOL_LABEL_USER_PROMPT = originalEnv.photoToolLabelUserPrompt;
  env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT = originalEnv.documentSummarySystemPrompt;
  env.INFERENCE_STACKCHAN_SYSTEM_PROMPT = originalEnv.stackchanSystemPrompt;
});

describe('inference-prompt-registry', () => {
  it('returns defaults when env overrides are unset', () => {
    env.PHOTO_TOOL_LABEL_USER_PROMPT = undefined;
    env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT = undefined;
    env.INFERENCE_STACKCHAN_SYSTEM_PROMPT = undefined;

    expect(resolvePhotoLabelUserPrompt()).toBe(INFERENCE_PROMPT_DEFAULTS.photoLabelUserPrompt);
    expect(resolveDocumentSummarySystemPrompt()).toBe(INFERENCE_PROMPT_DEFAULTS.documentSummarySystemPrompt);
    expect(resolveStackChanSystemPrompt()).toBe(INFERENCE_PROMPT_DEFAULTS.stackchanSystemPrompt);
  });

  it('uses env overrides when set', () => {
    env.PHOTO_TOOL_LABEL_USER_PROMPT = '  カスタム写真プロンプト  ';
    env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT = 'カスタム要約システム';
    env.INFERENCE_STACKCHAN_SYSTEM_PROMPT = 'カスタムStackChan';

    expect(resolvePhotoLabelUserPrompt()).toBe('カスタム写真プロンプト');
    expect(resolveDocumentSummarySystemPrompt()).toBe('カスタム要約システム');
    expect(resolveStackChanSystemPrompt()).toBe('カスタムStackChan');
  });

  it('falls back to defaults for empty or whitespace env values', () => {
    env.PHOTO_TOOL_LABEL_USER_PROMPT = '   ';
    env.INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT = '\t';
    env.INFERENCE_STACKCHAN_SYSTEM_PROMPT = '';

    expect(resolvePhotoLabelUserPrompt()).toBe(INFERENCE_PROMPT_DEFAULTS.photoLabelUserPrompt);
    expect(resolveDocumentSummarySystemPrompt()).toBe(INFERENCE_PROMPT_DEFAULTS.documentSummarySystemPrompt);
    expect(resolveStackChanSystemPrompt()).toBe(INFERENCE_PROMPT_DEFAULTS.stackchanSystemPrompt);
  });
});
