import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobilePlacementRegisterSection } from './MobilePlacementRegisterSection';

describe('MobilePlacementRegisterSection', () => {
  const base = {
    shelfCode: '',
    onSelectShelf: vi.fn(),
    onOpenShelfRegister: vi.fn(),
    onShelfQrScan: vi.fn(),
    registeredShelves: [],
    registeredShelvesLoading: false,
    registeredShelvesError: false,
    onRetryRegisteredShelves: vi.fn(),
    orderBarcode: '',
    onOrderBarcodeChange: vi.fn(),
    onOrderScan: vi.fn(),
    branches: [],
    branchesLoading: false,
    branchesError: false,
    onRetryBranches: vi.fn(),
    selectedBranchId: null,
    onSelectBranchId: vi.fn(),
    suggestedNextBranchNo: 1,
    registerSubmitting: false,
    registerSubmittingAction: null as const,
    createNewDisabled: true,
    moveDisabled: true,
    onCreateNewPlacement: vi.fn(),
    onMovePlacement: vi.fn(),
    registerMessage: null,
    registerError: null
  };

  it('右端の独立「登録」ボタンはなく、新規登録と棚移動の2ボタンがある', () => {
    render(<MobilePlacementRegisterSection {...base} />);

    expect(screen.getByRole('button', { name: '新規登録' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '棚移動' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登録' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移動を確定' })).not.toBeInTheDocument();
  });
});
