import {
  selfInspectionKioskButtonClass,
  type SelfInspectionKioskButtonSize
} from './selfInspectionKioskTheme';

import type { ButtonHTMLAttributes } from 'react';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'disabled'> & {
  disabled?: boolean;
  size?: SelfInspectionKioskButtonSize;
  wide?: boolean;
  pressed?: boolean;
};

/**
 * 自主検査セッション用ボタン。共通 Button は使わず disabled 見た目をテーマで統一する。
 */
export function SelfInspectionKioskButton({
  disabled = false,
  size = 'default',
  wide = false,
  pressed,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-pressed={pressed}
      className={selfInspectionKioskButtonClass({ disabled, size, wide, pressed })}
      {...rest}
    />
  );
}
