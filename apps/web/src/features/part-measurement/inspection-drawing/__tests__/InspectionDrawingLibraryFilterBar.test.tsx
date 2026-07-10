import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InspectionDrawingLibraryFilterBar } from '../InspectionDrawingLibraryFilterBar';

import type { ComponentProps } from 'react';

function renderFilterBar(overrides: Partial<ComponentProps<typeof InspectionDrawingLibraryFilterBar>> = {}) {
  const props: ComponentProps<typeof InspectionDrawingLibraryFilterBar> = {
    fhincd: '',
    onFhincdChange: vi.fn(),
    visualName: '',
    onVisualNameChange: vi.fn(),
    resourceCd: '',
    onResourceCdChange: vi.fn(),
    resourceOptions: ['R001'],
    resourceNameMap: {},
    processFilter: 'all',
    onProcessFilterChange: vi.fn(),
    includeInactive: false,
    onIncludeInactiveChange: vi.fn(),
    showInactiveTemplates: false,
    onShowInactiveTemplatesChange: vi.fn(),
    onReload: vi.fn(),
    onReset: vi.fn(),
    resetDisabled: true,
    ...overrides
  };
  render(<InspectionDrawingLibraryFilterBar {...props} />);
  return props;
}

describe('InspectionDrawingLibraryFilterBar', () => {
  it('uses reload and reset actions instead of the old update action', () => {
    renderFilterBar();

    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再読込' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'リセット' })).toBeDisabled();
  });

  it('calls reload and reset handlers', () => {
    const props = renderFilterBar({ resetDisabled: false });

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }));

    expect(props.onReload).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('keeps the resource filter at an explicit compact width', () => {
    renderFilterBar();

    expect(screen.getByLabelText('資源CD').parentElement).toHaveClass('w-[19rem]');
    expect(screen.getByLabelText('資源CD').parentElement).not.toHaveClass('w-full');
  });

  it('renders a controlled inactive-template visibility toggle immediately after history', () => {
    const props = renderFilterBar();
    const history = screen.getByRole('checkbox').closest('label');
    const toggle = screen.getByRole('button', { name: '無効ON' });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(history?.nextElementSibling).toBe(toggle);
    fireEvent.click(toggle);
    expect(props.onShowInactiveTemplatesChange).toHaveBeenCalledWith(true);
  });

  it('shows the highlighted OFF action while inactive templates are visible', () => {
    renderFilterBar({ showInactiveTemplates: true });

    const toggle = screen.getByRole('button', { name: '無効OFF' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-red-600');
  });
});
