import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { initialActualSlipOcrFeedback } from '../actual-slip-ocr-feedback';

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
          ...initialActualSlipOcrFeedback,
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

it('offers ambiguous candidates as large buttons that set the field', () => {
  const onChange = vi.fn();
  render(<ActualSlipVerifyColumn
    manufacturingOrderField={{ id: 'mo', value: '', onChange: vi.fn(), onScan: vi.fn() }}
    fseibanField={{ id: 'fs', value: '', onChange }}
    partNumberField={{ id: 'part', value: '', onChange: vi.fn(), onScan: vi.fn() }}
    onImageOcr={vi.fn()} imageOcrBusy={false}
    ocrFeedback={{ ...initialActualSlipOcrFeedback, status: 'success', fseibanMatch: 'ambiguous',
      fseibanCandidates: ['BE1N9321', 'BE1N9327'] }}
  />);
  expect(screen.getByText('製番を選んでください')).toBeInTheDocument();
  for (const candidate of ['BE1N9321', 'BE1N9327']) {
    const button = screen.getByRole('button', { name: candidate });
    expect(button).toHaveClass('min-h-[48px]', 'font-mono');
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith(candidate);
  }
});

it('shows the original and corrected FSEIBAN', () => {
  render(<ActualSlipVerifyColumn
    manufacturingOrderField={{ id: 'mo', value: '', onChange: vi.fn(), onScan: vi.fn() }}
    fseibanField={{ id: 'fs', value: 'BE1N9321', onChange: vi.fn() }}
    partNumberField={{ id: 'part', value: '', onChange: vi.fn(), onScan: vi.fn() }}
    onImageOcr={vi.fn()} imageOcrBusy={false}
    ocrFeedback={{ ...initialActualSlipOcrFeedback, status: 'success', fseibanMatch: 'corrected',
      fseibanRaw: '8E1N9321', fseiban: 'BE1N9321', fseibanCandidates: ['BE1N9321'] }}
  />);
  expect(screen.getByText('製番を補正: 8E1N9321 → BE1N9321')).toBeInTheDocument();
});
