import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  parseActualSlipImage: vi.fn(),
  registerOrderPlacement: vi.fn(),
  verifyMobilePlacementSlipMatch: vi.fn()
}));

import {
  parseActualSlipImage,
  registerOrderPlacement,
  verifyMobilePlacementSlipMatch
} from '../../api/client';

import { useMobilePlacementPageState } from './useMobilePlacementPageState';

describe('useMobilePlacementPageState', () => {
  it('parseActualSlipImage の製造orderと製番を状態に反映する', async () => {
    vi.mocked(parseActualSlipImage).mockResolvedValue({
      engine: 'stub',
      ocrText: '製造 オー ダ No 0002178005\n製 番 BE1N9321\n注文 番号 0003507502',
      // API は確定値ベースのプレビュー（実装と整合）
      ocrPreviewSafe: '0002178005 BE1N9321',
      manufacturingOrder10: '0002178005',
      fseiban: 'BE1N9321'
    });
    vi.mocked(registerOrderPlacement).mockResolvedValue({
      event: {
        id: 'evt-1',
        clientDeviceId: 'dev-1',
        shelfCodeRaw: 'A-01',
        manufacturingOrderBarcodeRaw: '0002178005',
        csvDashboardRowId: 'row-1',
        placedAt: '2026-04-11T00:00:00.000Z'
      },
      resolvedRowId: 'row-1'
    });
    vi.mocked(verifyMobilePlacementSlipMatch).mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useMobilePlacementPageState());

    await act(async () => {
      await result.current.parseActualSlipImageFile(new File(['dummy'], 'slip.jpg', { type: 'image/jpeg' }));
    });

    expect(result.current.actualOrder).toBe('0002178005');
    expect(result.current.actualFseiban).toBe('BE1N9321');
    expect(result.current.actualSlipOcrFeedback.status).toBe('success');
    expect(result.current.actualSlipOcrFeedback.manufacturingOrder10).toBe('0002178005');
    expect(result.current.actualSlipOcrFeedback.ocrPreview).toContain('0002178005');
    expect(result.current.actualSlipOcrFeedback.ocrPreview).toContain('BE1N9321');
  });
});
