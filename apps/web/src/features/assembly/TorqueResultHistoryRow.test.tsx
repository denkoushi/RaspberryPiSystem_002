import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TorqueResultHistoryRow } from './TorqueResultHistoryRow';

describe('TorqueResultHistoryRow', () => {
  it('emphasizes the measured value and successful result', () => {
    render(
      <TorqueResultHistoryRow
        locationLabel="丸数字 ①"
        recordedAt="2026-08-17T00:00:00.000Z"
        valueLabel="10 Nm"
        resultLabel="OK"
        resultTone="success"
      />
    );

    expect(screen.getByText('10 Nm')).toHaveClass('text-2xl', 'font-bold');
    expect(screen.getByText('OK')).toHaveClass('text-emerald-300');
    expect(screen.getByText('丸数字 ①')).toBeInTheDocument();
  });
});
