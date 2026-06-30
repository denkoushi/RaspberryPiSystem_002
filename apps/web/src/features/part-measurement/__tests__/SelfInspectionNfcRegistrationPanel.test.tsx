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
    nextActionLabel: '計測機器タグをスキャン',
    ...overrides
  };
}

describe('SelfInspectionNfcRegistrationPanel', () => {
  it('renders instrument and employee fields in a two-column grid with min-w-0', () => {
    const { container } = render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration()}
        requireMeasuringInstrumentTag={true}
      />
    );

    const grid = container.querySelector('.grid.grid-cols-2');
    expect(grid).toBeTruthy();
    expect(grid?.children).toHaveLength(2);
    for (const cell of Array.from(grid?.children ?? [])) {
      expect(cell).toHaveClass('min-w-0');
    }
    expect(screen.getByText('計測機器')).toBeInTheDocument();
    expect(screen.getByText('測定者')).toBeInTheDocument();
    expect(screen.getByText('未点検')).toBeInTheDocument();
    expect(screen.getByText('未登録')).toBeInTheDocument();
  });

  it('does not render nextActionLabel guidance text', () => {
    render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration({ nextActionLabel: '計測機器タグをスキャン' })}
        requireMeasuringInstrumentTag={true}
      />
    );

    expect(screen.queryByText('計測機器タグをスキャン')).not.toBeInTheDocument();
    expect(screen.queryByText('社員タグをスキャン')).not.toBeInTheDocument();
  });

  it('still renders registration message', () => {
    render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration({ message: '未登録のNFCタグです。' })}
        requireMeasuringInstrumentTag={true}
      />
    );
    expect(screen.getByText('未登録のNFCタグです。')).toBeInTheDocument();
  });

  it('shows optional instrument state when instrument tag is not required', () => {
    render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration()}
        requireMeasuringInstrumentTag={false}
      />
    );

    expect(screen.getByText('計測機器（任意）')).toBeInTheDocument();
    expect(screen.getByText('未点検（任意）')).toBeInTheDocument();
  });

  it('shows inspected instruments as a usage list', () => {
    render(
      <SelfInspectionNfcRegistrationPanel
        registration={makeRegistration()}
        requireMeasuringInstrumentTag={true}
        instrumentUsages={[
          {
            id: 'usage-1',
            measuringInstrumentId: 'inst-1',
            loanId: 'loan-1',
            measuringInstrumentManagementNumberSnapshot: 'MI-001',
            measuringInstrumentNameSnapshot: 'Caliper',
            measuringInstrumentTagUidSnapshot: 'inst-tag',
            preUseInspectedAt: '2026-06-30T00:00:00.000Z',
            createdAt: '2026-06-30T00:00:00.000Z',
            updatedAt: '2026-06-30T00:00:00.000Z'
          }
        ]}
      />
    );

    expect(screen.getByText('MI-001 Caliper')).toBeInTheDocument();
    expect(screen.getByText('使用前点検済')).toBeInTheDocument();
  });
});
