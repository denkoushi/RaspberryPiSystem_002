import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LeaderBoardSeibanListPanel } from '../LeaderBoardSeibanListPanel';

describe('LeaderBoardSeibanListPanel', () => {
  it('isOpen=false のときダイアログを描画しない', () => {
    render(
      <LeaderBoardSeibanListPanel
        isOpen={false}
        onClose={vi.fn()}
        entries={[{ fseiban: 'S1', machineName: '機種A' }]}
        sharedHistory={[]}
        historyWriting={false}
        onToggle={vi.fn()}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('製番・機種名を表示し、登録済みは aria-pressed=true', () => {
    render(
      <LeaderBoardSeibanListPanel
        isOpen
        onClose={vi.fn()}
        entries={[
          { fseiban: 'S1', machineName: '機種A' },
          { fseiban: 'S2', machineName: '' }
        ]}
        sharedHistory={['S1']}
        historyWriting={false}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.getByText('機種A')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();

    expect(screen.getByText('S1').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('S2').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('行ボタン押下で onToggle を呼ぶ', () => {
    const onToggle = vi.fn();
    render(
      <LeaderBoardSeibanListPanel
        isOpen
        onClose={vi.fn()}
        entries={[{ fseiban: 'S1', machineName: '機種A' }]}
        sharedHistory={[]}
        historyWriting={false}
        onToggle={onToggle}
      />
    );

    fireEvent.click(screen.getByText('S1').closest('button')!);
    expect(onToggle).toHaveBeenCalledWith('S1');
  });

  it('背景クリックで onClose', () => {
    const onClose = vi.fn();
    render(
      <LeaderBoardSeibanListPanel
        isOpen
        onClose={onClose}
        entries={[]}
        sharedHistory={[]}
        historyWriting={false}
        onToggle={vi.fn()}
      />
    );

    fireEvent.click(screen.getByLabelText('製番一覧を閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape で onClose', () => {
    const onClose = vi.fn();
    render(
      <LeaderBoardSeibanListPanel
        isOpen
        onClose={onClose}
        entries={[]}
        sharedHistory={[]}
        historyWriting={false}
        onToggle={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
