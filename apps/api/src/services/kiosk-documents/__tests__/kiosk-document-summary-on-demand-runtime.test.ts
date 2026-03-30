import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureReady = vi.fn();
const mockRelease = vi.fn();

vi.mock('../../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../inference/inference-runtime.js', () => ({
  getInferenceRuntime: () => ({
    isDocumentSummaryInferenceConfigured: () => true,
  }),
}));

vi.mock('../../inference/runtime/get-local-llm-runtime-controller.js', () => ({
  getLocalLlmRuntimeController: () => ({
    ensureReady: mockEnsureReady,
    release: mockRelease,
  }),
}));

describe('kiosk-document-summary-on-demand-runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    mockEnsureReady.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('withDocumentSummaryOnDemandRuntime skips controller when mode is always_on', async () => {
    vi.doMock('../../../config/env.js', () => ({
      env: {
        LOCAL_LLM_RUNTIME_MODE: 'always_on',
        KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED: true,
      },
    }));
    const { withDocumentSummaryOnDemandRuntime, kioskDocumentSummaryNeedsOnDemandRuntime } = await import(
      '../kiosk-document-summary-on-demand-runtime.js'
    );
    expect(kioskDocumentSummaryNeedsOnDemandRuntime()).toBe(false);

    const fn = vi.fn().mockResolvedValue(42);
    await expect(withDocumentSummaryOnDemandRuntime(fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockEnsureReady).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('withDocumentSummaryOnDemandRuntime calls ensure/release when on_demand and summary enabled', async () => {
    vi.doMock('../../../config/env.js', () => ({
      env: {
        LOCAL_LLM_RUNTIME_MODE: 'on_demand',
        KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED: true,
      },
    }));
    const { withDocumentSummaryOnDemandRuntime, kioskDocumentSummaryNeedsOnDemandRuntime } = await import(
      '../kiosk-document-summary-on-demand-runtime.js'
    );
    expect(kioskDocumentSummaryNeedsOnDemandRuntime()).toBe(true);

    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withDocumentSummaryOnDemandRuntime(fn)).resolves.toBe('ok');
    expect(mockEnsureReady).toHaveBeenCalledWith('document_summary');
    expect(mockRelease).toHaveBeenCalledWith('document_summary');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('withDocumentSummaryOnDemandRuntime still runs fn when ensure fails', async () => {
    vi.doMock('../../../config/env.js', () => ({
      env: {
        LOCAL_LLM_RUNTIME_MODE: 'on_demand',
        KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED: true,
      },
    }));
    mockEnsureReady.mockRejectedValueOnce(new Error('boom'));
    const { withDocumentSummaryOnDemandRuntime } = await import('../kiosk-document-summary-on-demand-runtime.js');

    const fn = vi.fn().mockResolvedValue(1);
    await expect(withDocumentSummaryOnDemandRuntime(fn)).resolves.toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
