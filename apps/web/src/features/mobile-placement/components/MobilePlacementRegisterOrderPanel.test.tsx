import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobilePlacementRegisterOrderPanel } from './MobilePlacementRegisterOrderPanel';

describe('MobilePlacementRegisterOrderPanel stamp label', () => {
  it('renders zero as 分配なし', () => {
    render(<MobilePlacementRegisterOrderPanel orderBarcode="100" onOrderScan={vi.fn()}
      orderPlacementIntent="move_existing" onOrderPlacementIntentChange={vi.fn()}
      branches={[{ id: 'none', branchNo: 0, shelfCodeRaw: 'A', manufacturingOrderBarcodeRaw: '100', csvDashboardRowId: null, updatedAt: '' }]}
      branchesLoading={false} branchesError={false} onRetryBranches={vi.fn()} selectedBranchId="none" onSelectBranchId={vi.fn()}
      suggestedNextBranchNo={1} registerSubmitting={false} registerDisabled={false} onRegister={vi.fn()} />);
    expect(screen.getByText('分配なし')).toBeInTheDocument();
    expect(screen.queryByText('分配0')).not.toBeInTheDocument();
  });
});
