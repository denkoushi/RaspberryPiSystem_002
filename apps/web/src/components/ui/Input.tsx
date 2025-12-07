import clsx from 'clsx';

import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return (
    <input
      className={clsx(
        'w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-white placeholder-white/60 focus:border-emerald-300 focus:outline-none',
        className
      )}
      {...rest}
    />
  );
}
