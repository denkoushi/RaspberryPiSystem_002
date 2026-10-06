import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it.each([undefined, 'min-h-11'])('only applies the optional button class when supplied (%s)', buttonClassName => {
    render(<ConfirmDialog isOpen title="確認" buttonClassName={buttonClassName} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    for (const button of within(screen.getByRole('dialog')).getAllByRole('button')) {
      if (buttonClassName) expect(button).toHaveClass(buttonClassName);
      else expect(button).not.toHaveClass('min-h-11');
    }
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveClass('flex-1', '!text-slate-700');
    expect(screen.getByRole('button', { name: 'OK' })).toHaveClass('flex-1', 'bg-emerald-500');
  });
});
