import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AssemblyLegacyTorqueEntry,
  AssemblyRequiredTorqueEntry,
  AssemblyTorqueHistory,
  AssemblyTorqueWorkflowActions
} from './AssemblyTorqueOperatorPanel';

import type { AssemblyTorqueRecordDto } from './types';

function record(overrides: Partial<AssemblyTorqueRecordDto> = {}): AssemblyTorqueRecordDto {
  return {
    id: 'record-1',
    sessionId: 'session-1',
    templateBoltId: 'bolt-1',
    attempt: 1,
    inputSource: 'manual',
    value: '90',
    inputUnit: 'kgf-cm',
    valueNm: null,
    judgement: 'ok',
    accepted: true,
    ignoredReason: null,
    recordedAt: '2026-07-18T00:00:00.000Z',
    createdAt: '2026-07-18T00:00:00.000Z',
    tighteningId: 'BOLT-1',
    markerNo: 1,
    areaId: 'area-1',
    areaName: 'ストッパー取付',
    ...overrides
  };
}

describe('AssemblyTorqueOperatorPanel', () => {
  it('keeps LEGACY input in one compact row and invokes the existing callbacks', () => {
    const onRecord = vi.fn();
    const onValueChange = vi.fn();
    render(
      <AssemblyLegacyTorqueEntry
        value=""
        source="manual"
        disabled={false}
        onValueChange={onValueChange}
        onSourceChange={vi.fn()}
        onRecord={onRecord}
      />
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'トルク値' }), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    expect(onValueChange).toHaveBeenCalledWith('90');
    expect(onRecord).toHaveBeenCalledOnce();
  });

  it('does not render a manual value textbox for REQUIRED agent entry', () => {
    render(
      <AssemblyRequiredTorqueEntry
        busy={false}
        agentConnected
        compatibleWrenches={[
          {
            profile: {
              id: 'profile-1',
              serialNumber: 'SERIAL_A',
              model: { modelNumber: 'CEM3-BTLA' },
              settingHistories: [{ nominalTorque: '90', unit: 'kgf-cm' }]
            } as never,
            conditionFingerprint: 'condition-1'
          }
        ]}
        selectedProfileId="profile-1"
        confirmation={{ id: 'confirmation-1', torqueWrenchProfileId: 'profile-1', settingHistoryId: 'setting-1' }}
        confirmationReused={false}
        onProfileChange={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.queryByRole('textbox', { name: 'トルク値' })).not.toBeInTheDocument();
    expect(screen.getByText('トルクエージェント')).toBeInTheDocument();
    expect(screen.getByText('現物確認済み・入力待機中')).toBeInTheDocument();
  });

  it('shows readable recent history with OK, NG, and unaccepted outcomes', () => {
    render(
      <AssemblyTorqueHistory
        records={[
          record({ id: 'ok', markerNo: 11 }),
          record({ id: 'ng', markerNo: 12, judgement: 'ng', accepted: true, value: '78', recordedAt: '2026-07-18T00:01:00.000Z' }),
          record({ id: 'ignored', markerNo: 13, judgement: 'ignored', accepted: false, value: null, recordedAt: '2026-07-18T00:02:00.000Z' })
        ]}
      />
    );

    expect(screen.getAllByText('丸数字 13')).toHaveLength(1);
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(screen.getByText('NG')).toBeInTheDocument();
    expect(screen.getByText('未受付')).toBeInTheDocument();
  });

  it('preserves workflow disabled conditions and callbacks', () => {
    const onAdvance = vi.fn();
    const onRestart = vi.fn();
    render(
      <AssemblyTorqueWorkflowActions
        busy={false}
        advanceDisabled
        restartDisabled={false}
        completeDisabled
        completeDisabledReason="締付が未完了です。"
        onAdvance={onAdvance}
        onRestart={onRestart}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '次工程へ' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '作業完了' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'やり直し' }));
    expect(onRestart).toHaveBeenCalledOnce();
  });
});
