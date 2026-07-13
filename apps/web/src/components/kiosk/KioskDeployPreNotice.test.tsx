import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KioskDeployPreNotice } from './KioskDeployPreNotice';

describe('KioskDeployPreNotice', () => {
  it('shows a persistent save-work warning without intercepting kiosk input', () => {
    render(<KioskDeployPreNotice />);

    expect(screen.getByText('この端末は1分後に更新を開始します。作業内容を保存し、操作を終了してください。'))
      .toBeInTheDocument();
    expect(screen.getByText('開始時刻を確認しています')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-deploy-pre-notice')).toHaveClass('pointer-events-none');
  });
});
