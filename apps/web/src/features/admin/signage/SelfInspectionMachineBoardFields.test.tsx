import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SelfInspectionMachineBoardFields } from './SelfInspectionMachineBoardFields';

import type { ComponentProps } from 'react';

const mockListCandidates = vi.fn();

vi.mock('../../../api/client', () => ({
  listAssemblyMachineNameCandidates: (...args: unknown[]) => mockListCandidates(...args),
}));

function renderFields(
  overrides: Partial<ComponentProps<typeof SelfInspectionMachineBoardFields>> = {}
) {
  return render(
    <SelfInspectionMachineBoardFields
      targetMode="kiosk_active_sessions"
      setTargetMode={vi.fn()}
      machineName=""
      setMachineName={vi.fn()}
      deviceScopeKey=""
      setDeviceScopeKey={vi.fn()}
      slideIntervalStr=""
      setSlideIntervalStr={vi.fn()}
      partsPerPageStr=""
      setPartsPerPageStr={vi.fn()}
      legacyAutoMigrationNotice={false}
      setLegacyAutoMigrationNotice={vi.fn()}
      {...overrides}
    />
  );
}

describe('SelfInspectionMachineBoardFields', () => {
  beforeEach(() => {
    mockListCandidates.mockReset();
    mockListCandidates.mockResolvedValue({ candidates: ['L300KP'], hasMore: false });
  });

  it('defaults to kiosk mode and hides legacy selection fields', () => {
    renderFields({ legacyAutoMigrationNotice: true });

    expect(screen.getByRole('combobox')).toHaveValue('kiosk_active_sessions');
    expect(screen.getByRole('option', { name: 'キオスク＞自主検査に表示中のアイテムのみ' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '全部品を表示' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('以前の自動選定設定を読み込みました');
    expect(screen.queryByText(/resourceCds/)).not.toBeInTheDocument();
    expect(screen.queryByText(/maxAutoMachines/)).not.toBeInTheDocument();
    expect(screen.queryByText(/deviceScopeKey/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('選択中の機種名')).not.toBeInTheDocument();
  });

  it('uses the numeric picker without a machine-name text input in manual mode', async () => {
    renderFields({ targetMode: 'manual_machine_name' });

    expect(screen.getByRole('button', { name: '数字で選択' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('例: L300KP')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '数字で選択' }));
    expect(screen.getByRole('group', { name: '機種名数字テンキー' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '機種名文字検索' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockListCandidates).toHaveBeenCalledWith({ digitQuery: '', q: undefined, limit: 40 });
    });
  });
});
