import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PositionRankEditor } from './PositionRankEditor';

import type { PositionRankRow } from './positionRankModel';

const initialRows: PositionRankRow[] = [
  { positionName: '班長', rank: 'leader', employeeCount: 2 },
  { positionName: '主事', rank: null, employeeCount: 3 },
  { positionName: '技師', rank: null, employeeCount: 1 }
];
function setup(rows = initialRows) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onBack = vi.fn();
  render(<PositionRankEditor initialRows={rows} employeeTotal={6} onSave={onSave} onBack={onBack} />);
  return { onSave, onBack };
}
function move(name: string, label: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(screen.getByRole('button', { name: `${label}に置く` }));
}

describe('PositionRankEditor', () => {
  it('selects a chip then a rung, marks changes and resets to the saved ranks', () => {
    setup();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByRole('group', { name: '段が未設定' })).toBeInTheDocument();
    move('主事 3人', '部長相当');
    expect(within(screen.getByRole('group', { name: '部長相当' })).getByRole('button', { name: '主事 3人' })).toBeInTheDocument();
    expect(screen.getByLabelText('変更あり')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存（1件）' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(within(screen.getByRole('group', { name: '段が未設定' })).getByRole('button', { name: '主事 3人' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });
  it('moves focused chips with arrow keys, preserves focus and stops at the top', () => {
    setup();
    screen.getByRole('button', { name: '班長 2人' }).focus();
    for (const rung of ['係長相当', '課長相当', '部長相当', '役員相当', '役員相当']) {
      fireEvent.keyDown(screen.getByRole('button', { name: '班長 2人' }), { key: 'ArrowUp' });
      expect(within(screen.getByRole('group', { name: rung })).getByRole('button', { name: '班長 2人' })).toHaveFocus();
    }
    fireEvent.keyDown(screen.getByRole('button', { name: '班長 2人' }), { key: 'ArrowDown' });
    expect(within(screen.getByRole('group', { name: '部長相当' })).getByRole('button', { name: '班長 2人' })).toHaveFocus();
  });
  it('accepts drag and drop onto a rung', () => {
    setup();
    const dataTransfer = { setData: vi.fn(), getData: vi.fn().mockReturnValue('主事'), effectAllowed: '' };
    fireEvent.dragStart(screen.getByRole('button', { name: '主事 3人' }), { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '主事');
    fireEvent.drop(screen.getByRole('group', { name: '役員相当' }), { dataTransfer });
    expect(within(screen.getByRole('group', { name: '役員相当' })).getByRole('button', { name: '主事 3人' })).toBeInTheDocument();
  });
  it('saves all assigned positions, omits unset positions and resets the baseline on success', async () => {
    const { onSave } = setup();
    move('主事 3人', '役員相当');
    fireEvent.click(screen.getByRole('button', { name: '保存（1件）' }));
    await screen.findByText('保存しました');
    expect(onSave).toHaveBeenCalledWith({ ranks: [{ positionName: '班長', rank: 'leader' }, { positionName: '主事', rank: 'executive' }] });
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    move('主事 3人', '一般');
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(within(screen.getByRole('group', { name: '役員相当' })).getByRole('button', { name: '主事 3人' })).toBeInTheDocument();
  });
  it('preserves edits and allows retry after a failed save', async () => {
    const { onSave } = setup();
    onSave.mockRejectedValueOnce(new Error('failed'));
    move('主事 3人', '部長相当');
    fireEvent.click(screen.getByRole('button', { name: '保存（1件）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できませんでした');
    expect(within(screen.getByRole('group', { name: '部長相当' })).getByRole('button', { name: '主事 3人' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '保存（1件）' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '保存（1件）' }));
    await screen.findByText('保存しました');
  });
  it('confirms returning inline, supports cancel and discards only on explicit press', () => {
    const { onBack } = setup();
    move('主事 3人', '一般');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(onBack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.queryByText('保存せず戻る')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存（1件）' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    fireEvent.click(screen.getByRole('button', { name: '保存せず戻る' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
  it('hides an empty unset frame and returns immediately without edits', () => {
    const { onBack } = setup(initialRows.filter(row => row.rank !== null));
    expect(screen.queryByRole('group', { name: '段が未設定' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
