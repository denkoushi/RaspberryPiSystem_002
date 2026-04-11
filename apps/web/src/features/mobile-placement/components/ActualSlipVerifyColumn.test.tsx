import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ActualSlipVerifyColumn } from './ActualSlipVerifyColumn';

describe('ActualSlipVerifyColumn', () => {
  it('成功時はノイズの多い OCR プレビュー行を出さない', () => {
    render(
      <ActualSlipVerifyColumn
        manufacturingOrderField={{ id: 'mo', value: '0002178005', onChange: vi.fn(), onScan: vi.fn() }}
        fseibanField={{ id: 'fs', value: 'BE1N9321', onChange: vi.fn() }}
        partNumberField={{ id: 'part', value: 'P-1', onChange: vi.fn(), onScan: vi.fn() }}
        onImageOcr={vi.fn()}
        imageOcrBusy={false}
        ocrFeedback={{
          status: 'success',
          manufacturingOrder10: '0002178005',
          fseiban: 'BE1N9321',
          ocrPreview: '8440002178005 9321 0003507502',
          message: '読取結果を欄に反映しました。必要に応じて修正してください。',
          errorDetail: null
        }}
      />
    );

    expect(screen.getByText('製造order番号: 0002178005')).toBeInTheDocument();
    expect(screen.getByText('FSEIBAN: BE1N9321')).toBeInTheDocument();
    expect(screen.queryByText(/OCR:/)).not.toBeInTheDocument();
  });
});
