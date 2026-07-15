import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KioskDeployPreNotice } from './KioskDeployPreNotice';

describe('KioskDeployPreNotice', () => {
  it('shows a persistent save-work warning without intercepting kiosk input', () => {
    render(<KioskDeployPreNotice />);

    expect(screen.getByText('この端末は1分後に更新を開始します。作業内容を保存し、操作を終了してください。'))
      .toBeInTheDocument();
    expect(screen.getByText('開始時刻を確認しています')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-deploy-pre-notice')).toHaveClass('pointer-events-none');
  });

  it('starts centered, moves by arrow keys, ignores focused controls, and resets for a new run', () => {
    const { rerender } = render(
      <><button type="button">保存</button><KioskDeployPreNotice runId="run-1" /></>
    );
    const card = screen.getByTestId('kiosk-deploy-pre-notice');
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      width: 384,
      height: 180,
      top: 0,
      right: 384,
      bottom: 180,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });

    expect(card).toHaveStyle({ transform: 'translate(-50%, -50%) translate(0px, 0px)' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(card).toHaveStyle({ transform: 'translate(-50%, -50%) translate(10px, 0px)' });

    const save = screen.getByRole('button', { name: '保存' });
    save.focus();
    fireEvent.keyDown(save, { key: 'ArrowDown' });
    expect(card).toHaveStyle({ transform: 'translate(-50%, -50%) translate(10px, 0px)' });
    fireEvent.click(save);

    rerender(<><button type="button">保存</button><KioskDeployPreNotice runId="run-2" /></>);
    expect(card).toHaveStyle({ transform: 'translate(-50%, -50%) translate(0px, 0px)' });
  });
});
