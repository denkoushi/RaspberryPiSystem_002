import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KioskActiveLoanCard } from '../KioskActiveLoanCard';
import {
  KIOSK_ACTIVE_LOAN_CARD_FIXED_HEIGHT_PX,
  KIOSK_ACTIVE_LOAN_CARD_THUMB_DISPLAY_PX,
  kioskActiveLoanCardRootClassName,
  kioskActiveLoanCardThumbImgClassName,
} from '../kioskActiveLoanCardLayout';

describe('KioskActiveLoanCard', () => {
  const noop = () => {};

  const baseProps = {
    presentation: { kind: 'item' as const, primaryLine: 'アイテム', clientLocationLine: '場所' },
    thumbnailUrl: null as string | null,
    isOverdue: false,
    employeeDisplayName: '山田',
    borrowedAtDisplay: '2026/04/29 15:30',
    returnButtonLabel: '返却',
    cancelButtonLabel: '取消',
    actionsDisabled: false,
    onReturn: noop,
    onCancel: noop,
  };

  it('ルートに固定外寸（304px）とレイアウトモジュールのクラスを付与する', () => {
    render(<KioskActiveLoanCard {...baseProps} />);
    const root = screen.getByTestId('kiosk-active-loan-card');
    expect(root.className).toContain(kioskActiveLoanCardRootClassName);
    expect(root.className).toContain(`min-h-[${KIOSK_ACTIVE_LOAN_CARD_FIXED_HEIGHT_PX}px]`);
    expect(root.className).toContain(`h-[${KIOSK_ACTIVE_LOAN_CARD_FIXED_HEIGHT_PX}px]`);
  });

  it('本文カラムに右寄せクラスを付与する', () => {
    render(<KioskActiveLoanCard {...baseProps} />);
    expect(screen.getByText('アイテム').closest('.text-end')).not.toBeNull();
  });

  it('サムネあり時は 108px（1.5倍）クラスと画像 alt を付与する', () => {
    render(<KioskActiveLoanCard {...baseProps} thumbnailUrl="/storage/thumbnails/x_thumb.jpg" />);
    const img = screen.getByRole('img', { name: '撮影した写真' });
    expect(img.className).toContain(kioskActiveLoanCardThumbImgClassName);
    expect(img.className).toContain(`h-[${KIOSK_ACTIVE_LOAN_CARD_THUMB_DISPLAY_PX}px]`);
    expect(img.className).toContain(`w-[${KIOSK_ACTIVE_LOAN_CARD_THUMB_DISPLAY_PX}px]`);
  });

  it('サムネなし時は画像を描画しない', () => {
    render(<KioskActiveLoanCard {...baseProps} />);
    expect(screen.queryByRole('img', { name: '撮影した写真' })).toBeNull();
  });

  it('取消を本文より上の右端に分離し、下段は幅いっぱいの返却だけにする', () => {
    render(<KioskActiveLoanCard {...baseProps} thumbnailUrl="/storage/thumbnails/x_thumb.jpg" />);
    const cancelButton = screen.getByRole('button', { name: '取消' });
    const returnButton = screen.getByRole('button', { name: '返却' });
    const header = cancelButton.parentElement!;
    const body = header.nextElementSibling!;
    expect(header.className).toContain('justify-end');
    expect(body).toContainElement(screen.getByText('アイテム'));
    expect(body).toContainElement(screen.getByRole('img'));
    expect(body.nextElementSibling).toBe(returnButton.parentElement);
    expect(within(returnButton.parentElement!).getAllByRole('button')).toEqual([returnButton]);
    expect(returnButton).toHaveClass('w-full', 'min-h-11');
    expect(cancelButton).toHaveClass('min-h-11');
  });

  it.each([
    { kind: 'item' as const, primaryLine: 'アイテム', clientLocationLine: '場所' },
    { kind: 'instrument' as const, primaryLine: 'M-001', nameLine: 'ノギス', clientLocationLine: '場所' },
    { kind: 'rigging' as const, primaryLine: 'R-001', nameLine: '吊具', clientLocationLine: '場所' },
  ])('$kind の取消は品名を確認してから一度だけ実行する', (presentation) => {
    const onCancel = vi.fn();
    render(<KioskActiveLoanCard {...baseProps} presentation={presentation} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'この持出を取り消しますか？' });
    expect(dialog).toHaveAccessibleDescription(presentation.nameLine ?? presentation.primaryLine);
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual(['キャンセル', '取り消す']);
    fireEvent.click(within(dialog).getByRole('button', { name: '取り消す' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('返却は確認を挟まず一押しで実行する', () => {
    const onReturn = vi.fn();
    render(<KioskActiveLoanCard {...baseProps} onReturn={onReturn} />);
    fireEvent.click(screen.getByRole('button', { name: '返却' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['キャンセル', 'Escape'])('%s で確認を閉じても取消を実行しない', (dismiss) => {
    const onCancel = vi.fn();
    render(<KioskActiveLoanCard {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    if (dismiss === 'Escape') {
      fireEvent.keyDown(window, { key: 'Escape' });
    } else {
      fireEvent.click(screen.getByRole('button', { name: dismiss }));
    }
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('操作無効時は返却も取消確認も実行しない', () => {
    const onReturn = vi.fn();
    const onCancel = vi.fn();
    render(<KioskActiveLoanCard {...baseProps} actionsDisabled onReturn={onReturn} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '返却' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onReturn).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('確認中に操作無効になった場合も取消を実行しない', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<KioskActiveLoanCard {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    rerender(<KioskActiveLoanCard {...baseProps} actionsDisabled onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
