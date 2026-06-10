import {
  selfInspectionKioskButtonClass,
  type SelfInspectionKioskButtonSize,
  type SelfInspectionKioskButtonTone
} from './selfInspectionKioskTheme';

import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'disabled'> & {
  disabled?: boolean;
  size?: SelfInspectionKioskButtonSize;
  wide?: boolean;
  pressed?: boolean;
  highlighted?: boolean;
  tone?: SelfInspectionKioskButtonTone;
};

/**
 * 自主検査セッション用ボタン。共通 Button は使わず disabled 見た目をテーマで統一する。
 */
export function SelfInspectionKioskButton({
  disabled = false,
  size = 'default',
  wide = false,
  pressed,
  highlighted = false,
  tone = 'default',
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-pressed={pressed}
      className={selfInspectionKioskButtonClass({ disabled, size, wide, pressed, highlighted, tone })}
      {...rest}
    />
  );
}
