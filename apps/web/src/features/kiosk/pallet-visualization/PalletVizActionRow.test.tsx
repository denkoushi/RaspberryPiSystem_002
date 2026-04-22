import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PalletVizActionRow } from './PalletVizActionRow';

describe('PalletVizActionRow', () => {
  it('加工機が未解決のときは全削除を無効化する', () => {
    render(
      <PalletVizActionRow
        busy={false}
        canOperate={false}
        canClearPallet={false}
        hasSelectedItem={false}
        onAdd={vi.fn()}
        onOverwrite={vi.fn()}
        onDelete={vi.fn()}
        onClearPallet={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '全削除' })).toBeDisabled();
  });

  it('canClearPallet が true のときだけ全消去を実行できる', () => {
    const onClearPallet = vi.fn();

    render(
      <PalletVizActionRow
        busy={false}
        canOperate
        canClearPallet
        hasSelectedItem={false}
        onAdd={vi.fn()}
        onOverwrite={vi.fn()}
        onDelete={vi.fn()}
        onClearPallet={onClearPallet}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '全削除' }));

    expect(onClearPallet).toHaveBeenCalledTimes(1);
  });

  it('compact 時も4つの操作ボタンが表示される', () => {
    render(
      <PalletVizActionRow
        density="compact"
        busy={false}
        canOperate
        canClearPallet
        hasSelectedItem
        onAdd={vi.fn()}
        onOverwrite={vi.fn()}
        onDelete={vi.fn()}
        onClearPallet={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '追加' })).toBeVisible();
    expect(screen.getByRole('button', { name: '上書' })).toBeVisible();
    expect(screen.getByRole('button', { name: '選択削除' })).toBeVisible();
    expect(screen.getByRole('button', { name: '全削除' })).toBeVisible();
  });
});
