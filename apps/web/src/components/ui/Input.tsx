import clsx from 'clsx';
import { forwardRef } from 'react';

import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function InputComponent({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        'w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-slate-900 placeholder-slate-500 focus:border-emerald-500 focus:outline-none',
        className
      )}
      {...rest}
    />
  );
});
