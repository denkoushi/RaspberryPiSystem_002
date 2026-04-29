import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(within(screen.getAllByRole('listitem')[1]).getByText('—')).toBeInTheDocument();

    expect(screen.getByText('S1').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('S2').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('共有履歴登録済みの製番がリスト先頭に並ぶ', () => {
    render(
      <LeaderBoardSeibanListPanel
        isOpen
        onClose={vi.fn()}
        entries={[
          { fseiban: 'B', machineName: '' },
          { fseiban: 'A', machineName: '' }
        ]}
        sharedHistory={['B']}
        historyWriting={false}
        onToggle={vi.fn()}
      />
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('B');
    expect(rows[1]).toHaveTextContent('A');
  });

  it('接頭辞ボタンで段階的に絞り込み、解除で戻る', () => {
    render(
      <LeaderBoardSeibanListPanel
        isOpen
        onClose={vi.fn()}
        entries={[
          { fseiban: 'AB', machineName: 'x' },
          { fseiban: 'AC', machineName: 'y' }
        ]}
        sharedHistory={[]}
        historyWriting={false}
        onToggle={vi.fn()}
      />
    );

    const list = screen.getByRole('list');
    expect(within(list).getByText('AB')).toBeInTheDocument();
    expect(within(list).getByText('AC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /接頭辞の末尾に「A」/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /接頭辞の末尾に「B」/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /接頭辞の末尾に「A」/ }));
    expect(within(list).getByText('AB')).toBeInTheDocument();
    expect(within(list).getByText('AC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /接頭辞の末尾に「B」/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /接頭辞の末尾に「C」/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /接頭辞の末尾に「B」/ }));
    expect(within(list).getByText('AB')).toBeInTheDocument();
    expect(within(list).queryByText('AC')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /接頭辞の末尾に「C」/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '接頭辞フィルタを解除' }));
    expect(within(list).getByText('AB')).toBeInTheDocument();
    expect(within(list).getByText('AC')).toBeInTheDocument();
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
