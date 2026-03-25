import clsx from 'clsx';

import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'ghostOnDark';
};

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
      : variant === 'secondary'
        ? 'bg-blue-500 text-white hover:bg-blue-600'
        : variant === 'ghostOnDark'
          ? 'bg-transparent text-white/90 hover:bg-white/10 hover:text-white'
          : 'bg-transparent !text-slate-900 hover:bg-slate-100 hover:!text-slate-900';

  return (
    <button
      className={clsx(
        'rounded-md px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variantClass,
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
