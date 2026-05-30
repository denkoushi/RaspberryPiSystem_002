import clsx from 'clsx';

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'ghostOnDark';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'ghostOnDark';
};

const buttonBaseClassName =
  'rounded-md px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export function buttonClassName(variant: ButtonVariant = 'primary', className?: string): string {
  const variantClass =
    variant === 'primary'
      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
      : variant === 'secondary'
        ? 'bg-blue-500 text-white hover:bg-blue-600'
        : variant === 'danger'
          ? 'bg-red-600 text-white hover:bg-red-500'
          : variant === 'ghostOnDark'
            ? 'border border-white/20 bg-transparent text-white/90 hover:bg-white/10 hover:text-white'
            : 'bg-transparent text-slate-800 hover:bg-slate-100 hover:text-slate-900';

  return clsx(buttonBaseClassName, variantClass, className);
}

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={buttonClassName(variant, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
