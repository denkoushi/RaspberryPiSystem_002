import clsx from 'clsx';

import type { ButtonHTMLAttributes } from 'react';

type PillToggleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isActive: boolean;
  activeClassName: string;
  inactiveClassName: string;
  size?: 'sm' | 'md';
};

const sizeClass = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-3 py-2 text-sm'
};

export function PillToggle({
  isActive,
  activeClassName,
  inactiveClassName,
  size = 'sm',
  className,
  ...rest
}: PillToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      className={clsx(
        'rounded-full border font-semibold transition-colors',
        sizeClass[size],
        isActive ? activeClassName : inactiveClassName,
        className
      )}
      {...rest}
    />
  );
}
