import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobilePlacementRegisterSection } from './MobilePlacementRegisterSection';

describe('MobilePlacementRegisterSection', () => {
  it('高視認テーマの文言へ更新し、旧ラベルを出さない', () => {
    render(
      <MobilePlacementRegisterSection
        shelfCode="西-北-02"
        onSelectShelf={vi.fn()}
        onOpenShelfRegister={vi.fn()}
        onShelfQrScan={vi.fn()}
        registeredShelves={[]}
        registeredShelvesLoading={false}
        registeredShelvesError={false}
        onRetryRegisteredShelves={vi.fn()}
        orderBarcode=""
        onOrderBarcodeChange={vi.fn()}
        onOrderScan={vi.fn()}
        orderPlacementIntent="move_existing"
        onOrderPlacementIntentChange={vi.fn()}
        branches={[]}
        branchesLoading={false}
        branchesError={false}
        onRetryBranches={vi.fn()}
        selectedBranchId={null}
        onSelectBranchId={vi.fn()}
        suggestedNextBranchNo={1}
        registerSubmitting={false}
        registerDisabled={false}
        onRegister={vi.fn()}
        registerMessage={null}
        registerError={null}
      />
    );

    expect(screen.getByRole('button', { name: '新規配分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '既存配分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '確定' })).toBeInTheDocument();
    expect(screen.queryByText('登録済みの棚番')).not.toBeInTheDocument();
    expect(screen.queryByText('照合OK → 棚 → 製造order → 分配の選択 → 登録/移動')).not.toBeInTheDocument();
  });
});
