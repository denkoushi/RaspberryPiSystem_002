import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useInspectionDrawingUnsavedChangesGuard } from '../useInspectionDrawingUnsavedChangesGuard';

function GuardFixture({ shouldBlock }: { shouldBlock: boolean }) {
  useInspectionDrawingUnsavedChangesGuard(shouldBlock);
  return <a href="/kiosk/part-measurement/inspection">一覧へ戻る</a>;
}

describe('useInspectionDrawingUnsavedChangesGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prevents internal navigation when the user cancels', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<GuardFixture shouldBlock />);
    const event = fireEvent.click(screen.getByRole('link', { name: '一覧へ戻る' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
  });

  it('allows internal navigation when the user confirms', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<GuardFixture shouldBlock />);
    let defaultPreventedBeforeTestHandler: boolean | null = null;
    const link = screen.getByRole('link', { name: '一覧へ戻る' });
    link.addEventListener('click', (event) => {
      defaultPreventedBeforeTestHandler = event.defaultPrevented;
      event.preventDefault();
    });
    fireEvent.click(link);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(defaultPreventedBeforeTestHandler).toBe(false);
  });

  it('does not prompt when disabled', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<GuardFixture shouldBlock={false} />);
    let defaultPreventedBeforeTestHandler: boolean | null = null;
    const link = screen.getByRole('link', { name: '一覧へ戻る' });
    link.addEventListener('click', (event) => {
      defaultPreventedBeforeTestHandler = event.defaultPrevented;
      event.preventDefault();
    });
    fireEvent.click(link);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(defaultPreventedBeforeTestHandler).toBe(false);
  });
});
