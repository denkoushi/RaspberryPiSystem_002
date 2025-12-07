import clsx from 'clsx';

import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'secondary';
};

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'rounded-md px-4 py-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary'
          ? 'bg-emerald-500 text-white hover:bg-emerald-600'
          : variant === 'secondary'
          ? 'bg-blue-500 text-white hover:bg-blue-600'
          : 'bg-transparent text-slate-100 hover:bg-white/10',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
