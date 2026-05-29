import { describe, expect, it } from 'vitest';

import {
  assertRuntimeCapabilitiesForUseCase,
  buildRuntimeStartRequestBody,
  CAPABILITY_VISION,
  evaluateVisionRuntimeReadyFromOverview,
  useCaseRequiresVision,
} from '../business-runtime-readiness.js';

describe('business-runtime-readiness', () => {
  it('buildRuntimeStartRequestBody omits modelProfileId when not sending', () => {
    expect(
      buildRuntimeStartRequestBody({
        useCase: 'photo_label',
        sendProfile: false,
        profileId: 'business_qwen35_35b_gguf',
      })
    ).toEqual({ reason: 'photo_label' });
  });

  it('buildRuntimeStartRequestBody includes modelProfileId when opt-in', () => {
    expect(
      buildRuntimeStartRequestBody({
        useCase: 'document_summary',
        sendProfile: true,
        profileId: 'business_qwen36_27b_nvfp4',
      })
    ).toEqual({
      reason: 'document_summary',
      modelProfileId: 'business_qwen36_27b_nvfp4',
    });
  });

  it('useCaseRequiresVision is true only for photo_label', () => {
    expect(useCaseRequiresVision('photo_label')).toBe(true);
    expect(useCaseRequiresVision('document_summary')).toBe(false);
    expect(useCaseRequiresVision('admin_console_chat')).toBe(false);
  });

  it('assertRuntimeCapabilitiesForUseCase rejects photo_label without vision capability', () => {
    expect(() =>
      assertRuntimeCapabilitiesForUseCase(
        { runtimeReadyCapabilities: ['text'], visionReadyReason: 'mmproj_missing' },
        'photo_label'
      )
    ).toThrow(/lacks vision runtime capability/);
  });

  it('evaluateVisionRuntimeReadyFromOverview fails when vision declared but runtime not ready', () => {
    const result = evaluateVisionRuntimeReadyFromOverview({
      activeProfileId: 'business_qwen35_35b_gguf',
      activeRuntimeState: {
        runtimeReadyCapabilities: ['text'],
        visionReadyReason: 'mmproj_missing',
      },
      selectedProfileId: 'business_qwen35_35b_gguf',
      selectedDeclaresVision: true,
    });
    expect(result.satisfied).toBe(false);
    expect(result.detailJa).toContain('vision runtime');
  });

  it('evaluateVisionRuntimeReadyFromOverview passes when vision capability is ready', () => {
    const result = evaluateVisionRuntimeReadyFromOverview({
      activeProfileId: 'business_qwen35_35b_gguf',
      activeRuntimeState: {
        runtimeReadyCapabilities: ['text', CAPABILITY_VISION],
        visionReadyReason: 'vision',
      },
      selectedProfileId: 'business_qwen35_35b_gguf',
      selectedDeclaresVision: true,
    });
    expect(result.satisfied).toBe(true);
  });
});
