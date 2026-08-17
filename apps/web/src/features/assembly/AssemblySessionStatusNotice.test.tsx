import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssemblySessionStatusNotice } from './AssemblySessionStatusNotice';

describe('AssemblySessionStatusNotice', () => {
  it('uses a polite status region for ordinary progress messages', () => {
    render(<AssemblySessionStatusNotice message="入力待機中" />);

    const notice = screen.getByTestId('assembly-work-session-status');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(notice).toHaveClass('truncate');
    expect(notice).not.toHaveClass('whitespace-normal', 'break-words');
    expect(notice).toHaveTextContent('入力待機中');
  });

  it('prioritizes errors with an assertive alert region', () => {
    render(<AssemblySessionStatusNotice message="レンチ接続が切れました。" tone="error" />);

    const notice = screen.getByRole('alert');
    expect(notice).toHaveAttribute('aria-live', 'assertive');
    expect(notice).toHaveClass('whitespace-normal', 'break-words');
    expect(notice).not.toHaveClass('truncate');
    expect(notice).toHaveTextContent('レンチ接続が切れました。');
    expect(notice.className).toContain('bg-rose-950/70');
  });
});
