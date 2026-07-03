import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelfInspectionSessionHeader } from '../SelfInspectionSessionHeader';

const baseProps = {
  productNo: '0003864550',
  fhincd: 'ABC123',
  resourceCd: 'R001',
  fhinmei: 'テスト品名',
  modeLabel: '手動',
  requiredEntryCount: 3,
  entryCountBlockedReason: null,
  guideMode: 'manual' as const,
  guideActionsEnabled: true,
  canResumeGuide: false,
  zoomEnabled: true,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onFitToView: vi.fn(),
  onResumeGuide: vi.fn(),
  onNextPoint: vi.fn(),
  onBackToList: vi.fn()
};

describe('SelfInspectionSessionHeader', () => {
  it('renders workbench camera OFF as inactive but clickable', () => {
    const onToggle = vi.fn();
    render(
      <SelfInspectionSessionHeader
        {...baseProps}
        workbenchCameraEnabled={false}
        onToggleWorkbenchCamera={onToggle}
      />
    );

    const button = screen.getByRole('button', { name: '手元カメラ OFF' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.className).toContain('bg-white/5');
    expect(button.className).toContain('text-white/40');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders workbench camera ON with default enabled visual', () => {
    render(
      <SelfInspectionSessionHeader
        {...baseProps}
        workbenchCameraEnabled={true}
        onToggleWorkbenchCamera={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: '手元カメラ ON' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.className).toContain('border-white/20');
    expect(button.className).toContain('bg-white/5');
    expect(button.className).not.toContain('text-white/40');
  });
});
