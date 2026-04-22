import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PalletVizActionRow } from './PalletVizActionRow';

describe('PalletVizActionRow', () => {
  it('加工機が未解決のときはパレット全消去を無効化する', () => {
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

    expect(screen.getByRole('button', { name: 'パレット全消去' })).toBeDisabled();
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

    fireEvent.click(screen.getByRole('button', { name: 'パレット全消去' }));

    expect(onClearPallet).toHaveBeenCalledTimes(1);
  });
});
