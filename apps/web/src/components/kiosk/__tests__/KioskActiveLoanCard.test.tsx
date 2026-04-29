import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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

  it('ルートに固定外寸（248px）とレイアウトモジュールのクラスを付与する', () => {
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
});
