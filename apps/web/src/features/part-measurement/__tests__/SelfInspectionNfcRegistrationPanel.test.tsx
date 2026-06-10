import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SelfInspectionNfcRegistrationPanel } from '../SelfInspectionNfcRegistrationPanel';

import type { SelfInspectionNfcRegistrationView } from '../useSelfInspectionNfcRegistration';

function makeRegistration(
  overrides: Partial<SelfInspectionNfcRegistrationView> = {}
): SelfInspectionNfcRegistrationView {
  return {
    employeeTagUid: null,
    employeeDisplayName: null,
    measuringInstrumentTagUid: null,
    measuringInstrumentDisplayName: null,
    status: 'idle',
    message: null,
    isReady: false,
    isLocked: false,
    nextActionLabel: '測定機器タグをスキャン',
    ...overrides
  };
}

describe('SelfInspectionNfcRegistrationPanel', () => {
  it('renders instrument and employee fields in a two-column grid with min-w-0', () => {
    const { container } = render(
      <SelfInspectionNfcRegistrationPanel registration={makeRegistration()} />
    );

    const grid = container.querySelector('.grid.grid-cols-2');
    expect(grid).toBeTruthy();
    expect(grid?.children).toHaveLength(2);
    for (const cell of Array.from(grid?.children ?? [])) {
      expect(cell).toHaveClass('min-w-0');
    }
    expect(screen.getByText('測定機器')).toBeInTheDocument();
    expect(screen.getByText('測定者')).toBeInTheDocument();
    expect(screen.getAllByText('未登録')).toHaveLength(2);
  });

  it('does not render nextActionLabel guidance text', () => {
    render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration({ nextActionLabel: '測定機器タグをスキャン' })}
      />
    );

    expect(screen.queryByText('測定機器タグをスキャン')).not.toBeInTheDocument();
    expect(screen.queryByText('社員タグをスキャン')).not.toBeInTheDocument();
  });

  it('still renders registration message and locked notice', () => {
    const { rerender } = render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration({ message: '未登録のNFCタグです。' })}
      />
    );
    expect(screen.getByText('未登録のNFCタグです。')).toBeInTheDocument();

    rerender(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration({ isLocked: true, nextActionLabel: null })}
      />
    );
    expect(screen.getByText('保存済みの登録は変更できません。')).toBeInTheDocument();
  });
});
