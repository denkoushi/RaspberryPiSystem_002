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
  actorLabel: '測定者' as const,
  guideMode: 'manual' as const,
  guideActionsEnabled: true,
  canResumeGuide: false,
  zoomEnabled: true,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onFitToView: vi.fn(),
  onResumeGuide: vi.fn(),
  onBackToList: vi.fn()
};

describe('SelfInspectionSessionHeader', () => {
  it('separates reset at the left edge and keeps navigation at the right without per-point actions', () => {
    const onReset = vi.fn();
    const onBackToList = vi.fn();
    const { rerender } = render(<SelfInspectionSessionHeader {...baseProps} onReset={onReset} onBackToList={onBackToList} />);
    const buttons = screen.getAllByRole('button');
    const reset = screen.getByRole('button', { name: '初期化' });
    expect(buttons[0]).toBe(reset);
    expect(buttons.at(-1)).toBe(screen.getByRole('button', { name: '一覧へ' }));
    expect(reset).toHaveClass('min-h-11', 'border-red-300/70');
    expect(reset.parentElement).toHaveClass('border-r', 'pr-3', 'mr-2');
    expect(screen.queryByRole('button', { name: '次の測定点' })).not.toBeInTheDocument();
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '一覧へ' }));
    expect(onBackToList).toHaveBeenCalledOnce();
    rerender(<SelfInspectionSessionHeader {...baseProps} onReset={onReset} resetDisabled />);
    expect(screen.getByRole('button', { name: '初期化' })).toBeDisabled();
  });

  it('keeps a fixed 54px three-region header with two-line identity and notice', () => {
    render(
      <SelfInspectionSessionHeader
        {...baseProps}
        actorDisplayName="山田 太郎"
        notice={{ message: '公差外（NG）の測定値が未確認です。', tone: 'red' }}
      />
    );

    expect(screen.getByTestId('self-inspection-session-header-band')).toHaveClass(
      'grid',
      'h-[54px]',
      'min-h-[54px]',
      'max-h-[54px]',
      'overflow-hidden'
    );
    expect(screen.getByText('製造order: 0003864550')).toBeInTheDocument();
    expect(screen.getByText('FHINCD: ABC123')).toBeInTheDocument();
    expect(screen.getByText('現在の測定者: 山田 太郎')).toBeInTheDocument();
    expect(screen.getByTestId('self-inspection-session-notice')).toHaveTextContent(
      '公差外（NG）の測定値が未確認です。'
    );
    expect(screen.getByTestId('self-inspection-session-notice')).toHaveClass('text-red-200');
    expect(screen.getByTestId('self-inspection-session-notice')).toHaveAttribute('aria-live', 'polite');
  });

  it('switches to inspector identity and preserves an empty actor row before authentication', () => {
    const { rerender } = render(
      <SelfInspectionSessionHeader {...baseProps} actorLabel="検査員" />
    );
    expect(screen.queryByText(/現在の検査員:/)).not.toBeInTheDocument();

    rerender(
      <SelfInspectionSessionHeader {...baseProps} actorLabel="検査員" actorDisplayName="佐藤 花子" />
    );
    expect(screen.getByText('現在の検査員: 佐藤 花子')).toBeInTheDocument();
  });

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
