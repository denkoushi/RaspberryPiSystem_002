import clsx from 'clsx';

import type { ButtonHTMLAttributes } from 'react';

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'sm' | 'md';
};

const sizeClass = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-3 py-2 text-sm'
};

export function PillButton({ size = 'sm', className, ...rest }: PillButtonProps) {
  return (
    <button
      type="button"
      className={clsx('rounded-full border font-semibold transition-colors', sizeClass[size], className)}
      {...rest}
    />
  );
}
