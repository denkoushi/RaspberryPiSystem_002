import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PalletVizItemCard } from '../PalletVizItemCard';

import type { PalletVizListItem } from '../palletVizListItem';

function makeItem(over: Partial<PalletVizListItem> = {}): PalletVizListItem {
  return {
    id: 'a1',
    palletNo: 12,
    fhincd: '4512345678901',
    fhinmei: '部品名サンプル',
    fseiban: 'SEI-26A-0042',
    machineName: null,
    machineNameDisplay: 'VTC-200C 表示名',
    plannedStartDateDisplay: '2026-04-20',
    plannedQuantity: 24,
    outsideDimensionsDisplay: null,
    ...over,
  };
}

describe('PalletVizItemCard', () => {
  it('行1〜3の値を表示し、aria-pressed を切り替える', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <PalletVizItemCard item={makeItem()} selected={false} onToggle={onToggle} />
    );

    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('VTC-200C 表示名')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('SEI-26A-0042')).toBeInTheDocument();
    expect(screen.getByText('4512345678901')).toBeInTheDocument();
    expect(screen.getByText('2026-04-20')).toBeInTheDocument();
    expect(screen.getByText('部品名サンプル')).toBeInTheDocument();

    rerender(<PalletVizItemCard item={makeItem()} selected onToggle={onToggle} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button')).toHaveClass('border-amber-400');
  });

  it('クリックで onToggle を呼ぶ', () => {
    const onToggle = vi.fn();
    render(<PalletVizItemCard item={makeItem()} selected={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('機種名がないとき中央は空のまま個数は右端に出る', () => {
    const { container } = render(
      <PalletVizItemCard
        item={makeItem({ machineName: null, machineNameDisplay: null, plannedQuantity: 8 })}
        selected={false}
        onToggle={vi.fn()}
      />
    );
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.queryByText('VTC-200C 表示名')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass('flex-1');
  });

  it('部品名は line-clamp-2 で表示し、外寸は表示しない', () => {
    render(
      <PalletVizItemCard
        item={makeItem({
          fhinmei: '長い部品名サンプル長い部品名サンプル長い部品名サンプル',
          outsideDimensionsDisplay: '100 x 200 x 300',
        })}
        selected={false}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('長い部品名サンプル長い部品名サンプル長い部品名サンプル')).toHaveClass('line-clamp-2');
    expect(screen.queryByText('100 x 200 x 300')).not.toBeInTheDocument();
  });
});
