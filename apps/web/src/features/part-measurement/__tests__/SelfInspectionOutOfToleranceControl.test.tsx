import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionOutOfToleranceControl } from '../SelfInspectionOutOfToleranceControl';

describe('SelfInspectionOutOfToleranceControl', () => {
  it('keeps an explicit acknowledgement button visible for unconfirmed NG', () => {
    const onRequestAcknowledgement = vi.fn();
    render(
      <SelfInspectionOutOfToleranceControl
        state={{ pointId: 'p1', acknowledged: false, label: 'NG・未確認' }}
        onRequestAcknowledgement={onRequestAcknowledgement}
      />
    );

    expect(screen.getByText('NG・未確認')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '公差外のまま進む' }));
    expect(onRequestAcknowledgement).toHaveBeenCalledTimes(1);
  });

  it('shows a persistent confirmed state after acknowledgement', () => {
    render(
      <SelfInspectionOutOfToleranceControl
        state={{ pointId: 'p1', acknowledged: true, label: 'NG・確認済み' }}
        onRequestAcknowledgement={() => undefined}
      />
    );

    expect(screen.getByText('NG・確認済み')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('公差外で確認済み');
    expect(screen.queryByRole('button', { name: '公差外のまま進む' })).toBeNull();
  });
});
