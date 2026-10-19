import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyMachineNamePickerDialog } from './AssemblyMachineNamePickerDialog';

const mockListCandidates = vi.fn();

vi.mock('../../api/client', () => ({
  listAssemblyMachineNameCandidates: (...args: unknown[]) => mockListCandidates(...args)
}));

describe('AssemblyMachineNamePickerDialog', () => {
  beforeEach(() => {
    mockListCandidates.mockReset();
    mockListCandidates.mockResolvedValue({
      candidates: ['L300KP-2', 'L300KP-10'],
      hasMore: true
    });
  });

  it('combines keypad and text filters, clears provisional selection, and commits only on confirm', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <AssemblyMachineNamePickerDialog
        isOpen
        currentValue="OLD-MACHINE"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(await screen.findByRole('button', { name: 'L300KP-2' })).toBeInTheDocument();
    expect(screen.getByText(/40件を超えています/)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: '機種名数字テンキー' })).getByRole('button', { name: '3' }));
    fireEvent.change(screen.getByRole('textbox', { name: '機種名文字検索' }), { target: { value: 'KP' } });
    await waitFor(() => {
      expect(mockListCandidates).toHaveBeenLastCalledWith({ digitQuery: '3', q: 'KP', limit: 40 });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'L300KP-2' }));
    const confirm = screen.getByRole('button', { name: 'この機種名を使用' });
    expect(confirm).toBeEnabled();
    fireEvent.change(screen.getByRole('textbox', { name: '機種名文字検索' }), { target: { value: 'KPX' } });
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'L300KP-10' }));
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('L300KP-10');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows candidate errors and cancel does not commit the current page value', async () => {
    mockListCandidates.mockRejectedValueOnce(new Error('network'));
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <AssemblyMachineNamePickerDialog
        isOpen
        currentValue="OLD-MACHINE"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('機種名候補を取得できませんでした');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores an older response that completes after a newer query', async () => {
    let resolveOld!: (value: { candidates: string[]; hasMore: boolean }) => void;
    mockListCandidates
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOld = resolve;
      }))
      .mockResolvedValueOnce({ candidates: ['NEW-2'], hasMore: false });
    render(
      <AssemblyMachineNamePickerDialog
        isOpen
        currentValue=""
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    await waitFor(() => expect(mockListCandidates).toHaveBeenCalledTimes(1));
    fireEvent.click(within(screen.getByRole('group', { name: '機種名数字テンキー' })).getByRole('button', { name: '2' }));
    await waitFor(() => expect(mockListCandidates).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'NEW-2' })).toBeInTheDocument();

    await act(async () => {
      resolveOld({ candidates: ['OLD'], hasMore: false });
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'OLD' })).not.toBeInTheDocument());
  });
});
