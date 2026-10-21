import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseActualSlipImage, snapFseibanTokens } from '../../api/client';

import { useMobilePlacementPageState } from './useMobilePlacementPageState';

import type { ActualSlipOcrResponse } from '../../api/domains/mobile-placement';
import type { ReactNode } from 'react';

vi.mock('../../api/client', () => ({
  parseActualSlipImage: vi.fn(), snapFseibanTokens: vi.fn(),
  moveOrderPlacementBranch: vi.fn(), registerOrderPlacement: vi.fn(), verifyMobilePlacementSlipMatch: vi.fn()
}));

const response: ActualSlipOcrResponse = {
  engine: 'device', ocrText: 'full text', ocrPreviewSafe: 'BA1S3332',
  manufacturingOrder10: '0002178005', fseiban: 'BA1S3332', fseibanRaw: 'BA1S333Z',
  fseibanMatch: 'corrected', fseibanCandidates: ['BA1S3332']
};
const nativeResult = {
  status: 'ok' as const, fseiban: 'BA1S333Z', tokens: ['BA1S333Z'],
  text: '製造オーダNo 0002178005\n製番 BA1S333Z'
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useMobilePlacementPageState(), {
    wrapper: ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.HaizenNative = { isAvailable: () => true, scanFseiban: vi.fn() };
  vi.mocked(snapFseibanTokens).mockResolvedValue(response);
  vi.mocked(parseActualSlipImage).mockResolvedValue(response);
});

afterEach(() => {
  cleanup();
  window.__haizenNativeScanResult?.({ status: 'cancelled' });
  delete window.HaizenNative;
});

describe('mobile placement native OCR', () => {
  it('stays busy through scan and API, prevents duplicate scans, and applies corrected server values', async () => {
    let resolveApi!: (value: ActualSlipOcrResponse) => void;
    vi.mocked(snapFseibanTokens).mockReturnValue(new Promise((resolve) => { resolveApi = resolve; }));
    const { result } = mount();
    let reading!: Promise<void>;
    act(() => { reading = result.current.scanActualSlipNative(); });
    expect(result.current.actualSlipImageOcrBusy).toBe(true);
    await act(async () => { await result.current.scanActualSlipNative(); });
    expect(window.HaizenNative!.scanFseiban).toHaveBeenCalledOnce();
    await act(async () => { window.__haizenNativeScanResult?.(nativeResult); });
    expect(snapFseibanTokens).toHaveBeenCalledWith({ tokens: nativeResult.tokens, text: nativeResult.text });
    expect(result.current.actualSlipImageOcrBusy).toBe(true);
    await act(async () => { resolveApi(response); await reading; });
    expect(result.current.actualOrder).toBe('0002178005');
    expect(result.current.actualFseiban).toBe('BA1S3332');
    expect(result.current.actualSlipOcrFeedback).toMatchObject({
      status: 'success', fseibanRaw: 'BA1S333Z', fseibanMatch: 'corrected', fseibanCandidates: ['BA1S3332']
    });
    expect(result.current.actualSlipImageOcrBusy).toBe(false);
    expect(parseActualSlipImage).not.toHaveBeenCalled();
  });

  it('keeps existing values and feedback on cancelled, without calling the API', async () => {
    const { result } = mount();
    await act(async () => { await result.current.parseActualSlipImageFile(new File(['image'], 'slip.png')); });
    const feedback = result.current.actualSlipOcrFeedback;
    let reading!: Promise<void>;
    act(() => { reading = result.current.scanActualSlipNative(); });
    await act(async () => {
      window.__haizenNativeScanResult?.({ status: 'cancelled' });
      await reading;
    });
    expect(snapFseibanTokens).not.toHaveBeenCalled();
    expect(result.current.actualOrder).toBe(response.manufacturingOrder10);
    expect(result.current.actualFseiban).toBe(response.fseiban);
    expect(result.current.actualSlipOcrFeedback).toBe(feedback);
    expect(result.current.actualSlipImageOcrBusy).toBe(false);
  });

  it.each(['native', 'photo'] as const)('uses the same no-candidate handling for %s', async (path) => {
    const empty = { ...response, manufacturingOrder10: null, fseiban: null, fseibanRaw: null,
      fseibanMatch: 'none' as const, fseibanCandidates: [] };
    vi.mocked(snapFseibanTokens).mockResolvedValue(empty);
    vi.mocked(parseActualSlipImage).mockResolvedValue(empty);
    const { result } = mount();
    await act(async () => {
      if (path === 'photo') await result.current.parseActualSlipImageFile(new File(['image'], 'slip.png'));
      else {
        const reading = result.current.scanActualSlipNative();
        window.__haizenNativeScanResult?.(nativeResult);
        await reading;
      }
    });
    expect(result.current.actualSlipOcrFeedback.status).toBe('no_candidate');
    expect(result.current.actualSlipImageOcrBusy).toBe(false);
  });

  it('shows API failure and clears busy so the user can retry', async () => {
    vi.mocked(snapFseibanTokens).mockRejectedValueOnce(new Error('offline'));
    const { result } = mount();
    await act(async () => {
      const reading = result.current.scanActualSlipNative();
      window.__haizenNativeScanResult?.(nativeResult);
      await reading;
    });
    expect(result.current.actualSlipOcrFeedback).toMatchObject({ status: 'error', errorDetail: 'offline' });
    expect(result.current.actualSlipImageOcrBusy).toBe(false);
    await act(async () => {
      const reading = result.current.scanActualSlipNative();
      window.__haizenNativeScanResult?.(nativeResult);
      await reading;
    });
    expect(result.current.actualSlipOcrFeedback.status).toBe('success');
  });
});
